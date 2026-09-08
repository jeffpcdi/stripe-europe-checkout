'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

// Executa os handlers reais isolados, sem Express, credenciais ou chamadas externas.
const source = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
const section = source.slice(source.indexOf('  // ── Públicos Personalizados'), source.indexOf('  // ── Deep-link'));
const handlers = {};
let policy = {}, calls = [], pixelFailure = false;
const context = {
  app: Object.fromEntries(['get','post','delete'].map(method => [method, (route, auth, handler) => { handlers[method + route] = handler; }])),
  dashboardAuth() {},
  requireAdvertiser: async (account, _, id) => { if (id !== 'allowed') throw Error('Conta não autorizada'); return { advertiserId: id }; },
  requireCampaignPixel: async () => { if (pixelFailure) throw Error('Pixel indisponível'); return { pixelId: 'central-pixel' }; },
  killSwitchActive: async () => !!policy.killSwitch,
  KILL_SWITCH_BODY: { error: 'Ações bloqueadas' },
  adsOps: { getSafetyPolicy: async () => policy },
  auditSimulated: async () => {},
  pipeboard: Object.fromEntries(['createCustomAudience','createLookalikeAudience','deleteCustomAudiences'].map(method => [method, async (...args) => { calls.push([method, ...args]); return { id:'created' }; }])),
  fail: (res, error) => res.status(400).json({error:error.message}),
};
vm.runInNewContext(section, context);
async function invoke(key, body = {}) {
  const res = { statusCode: 200, status(code) { this.statusCode=code; return this; }, json(value) { this.body=value; return this; } };
  await handlers[key]({ account:{id:'tenant'}, body:{adAccountId:'allowed',name:'Teste',audienceId:'aud-1',...body} }, res);
  return res;
}
(async () => {
  for (const key of ['post/api/ads/audiences','post/api/ads/audiences/lookalike','delete/api/ads/audiences']) {
    for (const next of [{enabled:true,dryRun:true}, {enabled:true,killSwitch:true}, {enabled:false}, {enabled:true,blockedAdvertiserIds:['allowed']}]) {
      policy=next; calls=[];
      const res=await invoke(key);
      assert.equal(calls.length,0,'proteção impede qualquer escrita '+key);
      assert(next.dryRun ? res.body.dryRun : res.statusCode >= 400);
    }
    policy={enabled:true,dryRun:false}; calls=[];
    assert.equal((await invoke(key, {adAccountId:'foreign'})).statusCode,400);
    assert.equal(calls.length,0,'outra conta é recusada');
    await invoke(key, {pixelId:'untrusted'});
    assert.equal(calls.length,1);
    assert.equal(calls[0][1],'allowed');
    if(key === 'post/api/ads/audiences') assert.equal(calls[0][2].pixelId,'central-pixel');
  }
  pixelFailure=true; calls=[];
  assert.equal((await invoke('post/api/ads/audiences')).statusCode,400);
  assert.equal(calls.length,0,'sem Pixel não cria público de site');

  // Paginação e disponibilidade no adapter Pipeboard.
  const mcp = require('../pipeboard-mcp');
  let pages=[];
  mcp.callTool=async (name,args)=>{
    assert.equal(name,'list_tiktok_custom_audiences'); pages.push(args.page);
    return { list: [{custom_audience_id:'a'+args.page,is_valid:args.page === 1 ? 'false' : true}], page_info:{total_page:2} };
  };
  const provider = require('../ads-provider');
  const audiences = await provider.listCustomAudiences('allowed',{fresh:true});
  assert.deepEqual(pages,[1,2]);
  assert.equal(audiences[0].isValid,false,'string false não significa pronto');
  assert.equal(audiences[1].isValid,true);
  await assert.rejects(provider.deleteCustomAudiences('allowed',[null,undefined,'']), /IDs/);
  console.log('ads-audiences-integrity: simulação, bloqueio, escopo, Pixel e paginação OK');
})().catch(error => { console.error(error); process.exitCode=1; });
