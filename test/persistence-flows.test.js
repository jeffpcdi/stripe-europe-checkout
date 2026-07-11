// Itens 265/266/268 (Leva 6): durabilidade de domínios personalizados através
// de "restart" simulado, comportamento do snapshot de gateways sem Redis e
// moeda por conta no caminho gateway → CAPI.
//
// Sem Neon/Redis reais o objetivo é validar os CONTRATOS de fallback:
//  - snapshot loaders devolvem null (nunca []) quando o Redis está off — a
//    distinção evita que "erro de leitura" seja tratado como "não há dados";
//  - domínios sobrevivem a um restart do processo via snapshot local em
//    arquivo (data/config.json), o último degrau da cadeia Neon → Redis → fs;
//  - a moeda informada pelo gateway chega intacta ao payload da CAPI.
const assert = require('assert');

// Modo sem banco/Redis (como o test runner roda no sandbox).
delete process.env.DATABASE_URL;
delete process.env.KV_REST_API_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

const ACC = 'accPersistTest';
let pass = 0;
function ok(cond, msg) {
  assert.ok(cond, msg);
  pass++;
  console.log('  [OK] ' + msg);
}

(async () => {
  // ── Item 266: snapshot de gateways sem Redis ──────────────────────────────
  const rdb = require('../redis');
  const gwSnap = await rdb.loadGatewaySnapshot();
  ok(gwSnap === null, 'gateways: snapshot sem Redis devolve null (não [] — erro ≠ vazio)');
  const pxSnap = await rdb.loadPixelSnapshot();
  ok(pxSnap === null, 'pixels: snapshot sem Redis devolve null (mesmo contrato)');

  // Boot sem banco E sem Redis: init não explode e cache fica utilizável.
  const gatewayStore = require('../gateway-store');
  const n = await gatewayStore.init();
  ok(typeof n === 'number', 'gateways: init sem banco/Redis não explode');

  // Webhook casa em memória: save → findByToken resolve o MESMO gateway.
  const g = await gatewayStore.save(ACC, { provider: 'hotmart', nome: 'GW Teste' });
  ok(g && g.webhookToken, 'gateways: save gera webhookToken');
  const found = gatewayStore.findByToken(g.webhookToken);
  ok(found && found.id === g.id && found.accountId === ACC, 'gateways: findByToken casa o webhook após save');

  // ── Item 265: domínio sobrevive a "restart" (snapshot local em arquivo) ──
  let config = require('../config');
  config.set(ACC, { customDomains: [{ host: 'promo.exemplo.com.br', uso: 'checkout' }] });
  const antes = config.get(ACC).customDomains;
  ok(antes.length === 1 && antes[0].host === 'promo.exemplo.com.br', 'domínios: set + get na mesma instância');

  // O write do snapshot tem debounce de 500ms + write assíncrono — espera o flush.
  await new Promise((r) => setTimeout(r, 900));

  // "Restart": derruba o módulo do require cache e recarrega do zero.
  delete require.cache[require.resolve('../config')];
  config = require('../config');
  await config.hydrate();
  const depois = config.get(ACC).customDomains;
  ok(
    depois.length === 1 && depois[0].host === 'promo.exemplo.com.br',
    'domínios: persistem após restart simulado (reload do snapshot local)'
  );
  ok(config.accountForDomain('promo.exemplo.com.br') === ACC, 'domínios: roteamento Host → conta continua resolvendo');

  // ── Item 268: moeda do gateway chega intacta ao payload da CAPI ──────────
  const norm = require('../conversion-normalize');
  const evt = norm.normalizeConversion(
    {
      event: 'PURCHASE_APPROVED',
      data: {
        buyer: { email: 'x@y.com' },
        purchase: { transaction: 'HP-EUR-1', price: { value: 49.9, currency_value: 'EUR' } },
      },
    },
    { gateway: 'hotmart' },
  );
  ok(evt && evt.currency === 'eur', 'moeda: EUR do gateway preservada na normalização (não força BRL)');
  ok(evt.amountCents === 4990, 'moeda: 49.90 → 4990 centavos, sem conversão implícita');

  // Limpeza: remove o domínio de teste do snapshot local compartilhado
  // (mesmo debounce de 500ms do persistDisk).
  config.set(ACC, { customDomains: [] });
  await new Promise((r) => setTimeout(r, 900));

  console.log('\n[persistence-flows] ' + pass + ' asserts OK');
})().catch((e) => {
  console.error('[FAIL]', e.message);
  process.exit(1);
});
