'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

// Executa os handlers reais isolados, sem Express, credenciais ou chamadas externas.
const source = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
const section = source.slice(source.indexOf('  // ── Públicos Personalizados'), source.indexOf('  // ── Deep-link'));
const handlers = {};
let policy = {};
let calls = [];
let pixelFailure = false;
let buyerCount = 0;
let buyerEmails = [];
let buyerListCalls = 0;

const context = {
  app: Object.fromEntries(['get','post','delete'].map(method => [method, (route, auth, handler) => { handlers[method + route] = handler; }])),
  dashboardAuth() {},
  crypto,
  db: {
    enabled: true,
    isReady: () => true,
    countPurchasedEmails: async () => buyerCount,
    listPurchasedEmails: async () => { buyerListCalls += 1; return buyerEmails; },
  },
  requireAdvertiser: async (account, _, id) => {
    if (id !== 'allowed') throw Error('Conta não autorizada');
    return { advertiserId: id };
  },
  requireCampaignPixel: async () => {
    if (pixelFailure) throw Error('Pixel indisponível');
    return { pixelId: 'central-pixel' };
  },
  killSwitchActive: async () => !!policy.killSwitch,
  KILL_SWITCH_BODY: { error: 'Ações bloqueadas' },
  adsOps: {
    getSafetyPolicy: async () => policy,
    appendAuditEvent: async () => {},
  },
  auditSimulated: async () => {},
  pipeboard: {
    ...Object.fromEntries(
      ['createCustomAudience','createLookalikeAudience','deleteCustomAudiences','shareCustomAudiences','uploadCustomerFileAudience']
        .map(method => [method, async (...args) => { calls.push([method, ...args]); return { id:'created' }; }]),
    ),
    listAdvertiserIds: async () => ['allowed','target'],
  },
  stats: { logEvent() {} },
  fail: (res, error) => res.status(error.status || 400).json({ error: error.message, code: error.code }),
};
vm.runInNewContext(section, context);

async function invoke(key, body = {}, query = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    set(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
  };
  const req = {
    account: { id:'tenant' },
    body: { adAccountId:'allowed', name:'Teste', audienceId:'aud-1', ...body },
    query: { adAccountId:'allowed', ...query },
  };
  await handlers[key](req, res);
  return res;
}

(async () => {
  for (const key of ['post/api/ads/audiences','post/api/ads/audiences/lookalike','delete/api/ads/audiences','post/api/ads/audiences/share']) {
    for (const next of [
      {enabled:true,dryRun:true},
      {enabled:true,killSwitch:true},
      {enabled:false},
      {enabled:true,blockedAdvertiserIds:['allowed']},
    ]) {
      policy=next; calls=[];
      const res=await invoke(key);
      assert.equal(calls.length,0,'proteção impede qualquer escrita '+key);
      assert(next.dryRun ? res.body.dryRun : res.statusCode >= 400);
    }

    policy={enabled:true,dryRun:false}; calls=[];
    assert.equal((await invoke(key, {adAccountId:'foreign'})).statusCode,400);
    assert.equal(calls.length,0,'outra conta é recusada');

    const validBody = key === 'post/api/ads/audiences/share'
      ? { pixelId:'untrusted', sharedAdvertiserId:'target' }
      : { pixelId:'untrusted' };
    await invoke(key, validBody);
    assert.equal(calls.length,1);
    assert.equal(calls[0][1],'allowed');
    if(key === 'post/api/ads/audiences') assert.equal(calls[0][2].pixelId,'central-pixel');
    if(key === 'post/api/ads/audiences/share') assert.deepEqual(calls[0][3],['target']);
  }

  policy={enabled:true,dryRun:false}; calls=[];
  assert.equal((await invoke('post/api/ads/audiences/share',{sharedAdvertiserId:'foreign'})).statusCode,403);
  assert.equal(calls.length,0,'destino não autorizado não recebe público');

  pixelFailure=true; calls=[];
  assert.equal((await invoke('post/api/ads/audiences')).statusCode,400);
  assert.equal(calls.length,0,'sem Pixel não cria público de site');
  pixelFailure=false;

  // Customer File: preview só expõe CONTAGEM, nunca e-mail/hash.
  buyerCount=999;
  let preview=await invoke('get/api/ads/audiences/customer-file/preview');
  assert.equal(preview.body.canCreate,false);
  assert.equal(preview.body.eligibleCount,999);
  assert.equal(preview.body.minimumRequired,1000);
  assert.ok(!JSON.stringify(preview.body).includes('@'),'preview não expõe PII');

  buyerCount=1000;
  preview=await invoke('get/api/ads/audiences/customer-file/preview');
  assert.equal(preview.body.canCreate,true);
  assert.equal(preview.body.eligibleCount,1000);
  assert.ok(!JSON.stringify(preview.body).includes('sha256'),'preview não expõe hashes');

  // Confirmação explícita é obrigatória antes de materializar a base.
  calls=[]; buyerListCalls=0; policy={enabled:true,dryRun:false};
  assert.equal((await invoke('post/api/ads/audiences/customer-file',{confirm:false})).statusCode,400);
  assert.equal(calls.length,0);
  assert.equal(buyerListCalls,0);

  // Abaixo do mínimo: falha fechada, zero chamada externa.
  buyerCount=999; calls=[]; buyerListCalls=0;
  const tooSmall=await invoke('post/api/ads/audiences/customer-file',{confirm:true});
  assert.equal(tooSmall.statusCode,409);
  assert.equal(tooSmall.body.code,'CUSTOMER_AUDIENCE_MINIMUM_NOT_MET');
  assert.equal(calls.length,0);
  assert.equal(buyerListCalls,0);

  // Dry-run: usa só a contagem e nunca materializa e-mail.
  buyerCount=1000; calls=[]; buyerListCalls=0; policy={enabled:true,dryRun:true};
  const simulated=await invoke('post/api/ads/audiences/customer-file',{confirm:true});
  assert.equal(simulated.body.dryRun,true);
  assert.equal(calls.length,0);
  assert.equal(buyerListCalls,0,'dry-run não carrega PII em memória');

  // Caminho real: normalização já veio do DB; rota envia SOMENTE SHA-256.
  policy={enabled:true,dryRun:false};
  buyerEmails=Array.from({length:1000},(_,i)=>`buyer${i}@example.com`);
  buyerCount=buyerEmails.length;
  calls=[]; buyerListCalls=0;
  const created=await invoke('post/api/ads/audiences/customer-file',{confirm:true,name:'Compradores 180d'});
  assert.equal(created.statusCode,202);
  assert.equal(created.body.processing,true);
  assert.equal(created.body.eligibleCount,1000);
  assert.equal(buyerListCalls,1);
  const upload=calls.find(call=>call[0]==='uploadCustomerFileAudience');
  assert.ok(upload,'envio usa wrapper dedicado do provider');
  assert.equal(upload[1],'allowed');
  const fileContent=upload[2].fileContent;
  assert.ok(fileContent.startsWith('Email_SHA256\n'));
  assert.ok(!fileContent.includes('buyer0@example.com'),'PII crua nunca chega ao Pipeboard');
  const firstHash=fileContent.split('\n')[1];
  assert.equal(firstHash,crypto.createHash('sha256').update('buyer0@example.com').digest('hex'));

  // Paginação e disponibilidade no adapter Pipeboard.
  const mcp = require('../pipeboard-mcp');
  let pages=[];
  mcp.callTool=async (name,args)=>{
    assert.equal(name,'list_tiktok_custom_audiences');
    pages.push(args.page);
    return {
      list: [{custom_audience_id:'a'+args.page,is_valid:args.page === 1 ? 'false' : true}],
      page_info:{total_page:2},
    };
  };
  const provider = require('../ads-provider');
  const audiences = await provider.listCustomAudiences('allowed',{fresh:true});
  assert.deepEqual(pages,[1,2]);
  assert.equal(audiences[0].isValid,false,'string false não significa pronto');
  assert.equal(audiences[1].isValid,true);
  await assert.rejects(provider.deleteCustomAudiences('allowed',[null,undefined,'']), /IDs/);

  let sharedArgs=null;
  mcp.callTool=async (name,args)=>{ sharedArgs={name,args}; return { ok:true }; };
  await provider.shareCustomAudiences('allowed',['aud-1','aud-1'],['target','allowed']);
  assert.equal(sharedArgs.name,'share_tiktok_custom_audience');
  assert.deepEqual(sharedArgs.args.custom_audience_ids,['aud-1']);
  assert.deepEqual(sharedArgs.args.shared_advertiser_ids,['target']);

  const hashed=crypto.createHash('sha256').update('buyer@example.com').digest('hex');
  const customerFile='Email_SHA256\n'+Array.from({length:1000},()=>hashed).join('\n');
  let customerFileArgs=null;
  mcp.callTool=async (name,args)=>{
    customerFileArgs={name,args};
    return { custom_audience_id:'customer-1' };
  };
  await provider.uploadCustomerFileAudience('allowed',{
    name:'Compradores',
    retentionDays:180,
    fileContent:customerFile,
  });
  assert.equal(customerFileArgs.name,'upload_tiktok_customer_file_audience');
  assert.equal(customerFileArgs.args.calculate_type,'EMAIL_SHA256');
  assert.equal(customerFileArgs.args.retention_in_days,180);
  assert.ok(!customerFileArgs.args.file_content.includes('buyer@example.com'));

  // Retenção: fallback usa created_at; uma edição tardia não rejuvenesce um comprador antigo.
  const dbSource=fs.readFileSync(require.resolve('../db'),'utf8');
  const buyerBlock=dbSource.slice(dbSource.indexOf('function purchasedAtSqlWindow'),dbSource.indexOf('async function insertEvent',dbSource.indexOf('function purchasedAtSqlWindow')));
  assert.match(buyerBlock,/ELSE created_at/);
  assert.doesNotMatch(buyerBlock,/ELSE updated_at/);

  // UI: recurso só aparece com canCreate e exige confirmação.
  const ui=fs.readFileSync(require.resolve('../dashboard/components/ads/audiences-dialog.tsx'),'utf8');
  assert.match(ui,/buyerPreview\?\.canCreate/);
  assert.match(ui,/Base própria · 180 dias/);
  assert.match(ui,/Confirmo que posso usar estes contatos/);
  assert.match(ui,/Nenhum e-mail é exibido nesta tela/);

  console.log('ads-audiences-integrity: segurança, Pixel, compartilhamento, Customer File e paginação OK');
})().catch(error => { console.error(error); process.exitCode=1; });
