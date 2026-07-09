// Testa os itens 51-55: a config de pixel precisa reportar corretamente se foi
// gravada de forma DURÁVEL, e o skip por credencial faltando precisa ser
// registrado no log (antes era silencioso). Sem banco/Redis reais, exercitamos
// o caminho "não durável" — que é justamente o cenário que fazia o pixel sumir.
const assert = require('assert');

// Garante modo sem banco (o test runner já roda assim no sandbox).
delete process.env.DATABASE_URL;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const pixelStore = require('../pixel-store');
const tt = require('../tiktok-events');

(async () => {
  await pixelStore.init();

  // 1) save() sem camada durável deve marcar _durable=false e expor o erro.
  const saved = await pixelStore.save('accTest', {
    name: 'Pixel Teste',
    pixelCode: 'ABC123',
    accessToken: 'tok_secreto',
    events: { CompletePayment: true }
  });
  assert.equal(saved._durable, false, 'sem banco/redis, save NÃO é durável');
  assert.ok(saved._saveError && /memória/i.test(saved._saveError), 'erro deve avisar que é volátil');

  // 2) health() reflete o estado da última gravação e conta os pixels.
  const h = pixelStore.health();
  assert.equal(h.durable, false, 'health.durable=false sem persistência');
  assert.equal(h.dbEnabled, false);
  assert.ok(h.count >= 1, 'pixel entrou no cache mesmo não sendo durável');
  console.log('[OK] durabilidade: save não durável é sinalizado (itens 51/52/53).');

  // 3) skip por credencial faltando deve gerar linha de log (item 55).
  const r = await tt.sendToPixel({ slug: 'x', acc: 'accTest', pixelCode: '', accessToken: '' }, { event: 'ViewContent', eventId: 'v0' });
  assert.equal(r.skipped, true, 'credencial vazia => skipped');
  assert.ok(Array.isArray(r.missing) && r.missing.length > 0, 'skip agora reporta o que faltou (item 55)');
  console.log('[OK] skip visível: faltando =>', JSON.stringify(r.missing));

  // 4) dispatch sem pixel casando retorna o MOTIVO (item 54). Evento não-monetário
  // para não cair na trava gateway-only. Assinatura: (eventName, p, routeHint, accountId).
  const disp = await tt.dispatchToAll('ViewContent', { eventId: 'e1', leadId: 'vid1' }, '*', 'accSemPixel');
  assert.equal(disp.dispatched, 0, 'sem pixel casando, dispatched=0');
  assert.ok(disp.reason && disp.reason.length > 0, 'dispatch sem alvo agora explica o motivo (item 54)');
  console.log('[OK] diagnóstico: dispatch sem alvo retorna motivo =>', JSON.stringify(disp.reason));

  // 5) evento monetário sem gateway continua BLOQUEADO (regressão da trava).
  const money = await tt.dispatchToAll('CompletePayment', { eventId: 'e2', leadId: 'vid2' }, '*', 'accTest');
  assert.equal(money.blocked, 'gateway-only', 'venda sem _trusted continua bloqueada');
  console.log('[OK] regressão: venda sem gateway segue bloqueada (gateway-only).');

  console.log('\n[PASS] pixel-durability: itens 51-55 verificados.');
})().catch((e) => { console.error('[FAIL]', e.message); process.exit(1); });
