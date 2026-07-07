'use strict';
/*
 * Teste de atribuição do vid (Fase 3).
 *
 * Bug corrigido: o vid clicado no /go é ecoado pelos gateways DENTRO de
 * containers de rastreio aninhados (Kiwify: trackingParameters.src/sck;
 * PerfectPay: metadata.src). O flattenGatewayPayload antigo não abria esses
 * containers, então o vid nunca subia ao topo → normalizeConversion não achava
 * o leadId → a venda virava ÓRFÃ → a CAPI disparava com identidade mínima
 * (EMQ ~1-3). Com o fix, o vid casa o lead do funil e a CAPI vai com ttclid +
 * email + phone + ip + ua + external_id (EMQ ~9).
 *
 * Parte A: normalização pura (conversion-normalize) — cobre Kiwify, PerfectPay,
 *          genérico e o caso Hotmart (sem tracking no corpo → cai em e-mail).
 * Parte B: EMQ ponta-a-ponta — reproduz o payload que o processConversion monta
 *          (server.js linhas ~2086) para venda CASADA vs ÓRFÃ e mede o EMQ real
 *          via ttEvents.dispatchToAll (fetch stubado), lendo o score do pushLog.
 */
const assert = require('assert');
const norm = require('../conversion-normalize');

const VID = 'v_abc123def456';

// ─────────────────────────────────────────────────────────────────────────────
// PARTE A — normalização: o vid ecoado precisa virar leadId
// ─────────────────────────────────────────────────────────────────────────────

// Kiwify: trackingParameters aninhado (camelCase) + Customer capitalizado
const kiwify = norm.normalizeConversion({
  webhook_event_type: 'order_approved',
  order_status: 'paid',
  order_id: 'KIWI-1001',
  charge_amount: 9700,                 // já em centavos
  Customer: { email: 'comprador@ex.com', full_name: 'Maria Silva' },
  trackingParameters: { src: VID, sck: null, utm_source: 'tiktok' }
}, { gateway: 'kiwify' });
assert.strictEqual(kiwify.leadId, VID, 'Kiwify: vid em trackingParameters.src deve virar leadId');
assert.strictEqual(kiwify.event, 'CompletePayment', 'Kiwify: order_approved → CompletePayment');
assert.strictEqual(kiwify.amountCents, 9700, 'Kiwify: charge_amount já em centavos (não multiplica)');
assert.strictEqual(kiwify.email, 'comprador@ex.com', 'Kiwify: email do Customer aninhado');

// Kiwify variação de caixa: TrackingParameters (PascalCase) — casing não pode quebrar
const kiwifyPascal = norm.normalizeConversion({
  webhook_event_type: 'order_approved', order_id: 'KIWI-1002', charge_amount: 4990,
  TrackingParameters: { sck: VID }
}, { gateway: 'kiwify' });
assert.strictEqual(kiwifyPascal.leadId, VID, 'Kiwify: vid em TrackingParameters.sck (PascalCase) deve virar leadId');

// PerfectPay: src dentro de metadata
const perfect = norm.normalizeConversion({
  sale_status_detail: 'approved', code: 'PP-2002', amount: 49.9,
  metadata: { src: VID }
}, { gateway: 'perfectpay' });
assert.strictEqual(perfect.leadId, VID, 'PerfectPay: vid em metadata.src deve virar leadId');
assert.strictEqual(perfect.amountCents, 4990, 'PerfectPay: 49.9 (unidade) → 4990 centavos');

// Genérico: src na raiz continua funcionando
const generico = norm.normalizeConversion({
  status: 'paid', transaction_id: 'GEN-3003', value: 100, src: VID
}, { gateway: 'generic' });
assert.strictEqual(generico.leadId, VID, 'Genérico: vid em src (raiz) deve virar leadId');

// Hotmart: NÃO ecoa src/sck no corpo do webhook v2 → leadId nulo, cai em e-mail.
// (documentado no CLAUDE.md; se a Hotmart passar a ecoar, adicionar o container)
const hotmart = norm.normalizeConversion({
  event: 'PURCHASE_APPROVED',
  data: {
    purchase: { transaction: 'HP-4004', price: { value: 197, currency_value: 'BRL' } },
    buyer: { email: 'buyer@hotmart.com' }
  }
}, { gateway: 'hotmart' });
assert.strictEqual(hotmart.leadId, null, 'Hotmart: sem tracking no corpo → leadId nulo (esperado)');
assert.strictEqual(hotmart.email, 'buyer@hotmart.com', 'Hotmart: email aninhado em data.buyer sobe');
assert.strictEqual(hotmart.amountCents, 19700, 'Hotmart: price.value 197 → 19700 centavos');
assert.strictEqual(hotmart.currency, 'brl', 'Hotmart: currency_value BRL');

console.log('[OK] Parte A — normalização: Kiwify(src/sck, 2 caixas), PerfectPay(metadata), genérico(raiz) casam o vid; Hotmart cai em e-mail.');

// ─────────────────────────────────────────────────────────────────────────────
// PARTE B — EMQ ponta-a-ponta: venda CASADA vs ÓRFÃ
// Stub de pixel-store / redis / fetch ANTES de carregar tiktok-events.
// ─────────────────────────────────────────────────────────────────────────────
const ACC = 'acc-emq';
const PIXEL = {
  slug: 'venda-eur', acc: ACC, pixelCode: 'PIXELCODE', accessToken: 'ACCESSTOKEN',
  active: true, routes: ['*'], events: { CompletePayment: true }
};

const psPath = require.resolve('../pixel-store');
require.cache[psPath] = { id: psPath, filename: psPath, loaded: true, exports: {
  forEvent(acc, ev, route) { return (acc === ACC && ev === 'CompletePayment') ? [PIXEL] : []; },
  get() { return PIXEL; }, getByToken() { return PIXEL; },
  list() { return [PIXEL]; }, forRoute() { return [PIXEL]; }
}};

// captura os EMQ registrados no pushLog (via rdb.pushPixelLog)
const emqByEvent = {};
const rdbPath = require.resolve('../redis');
require.cache[rdbPath] = { id: rdbPath, filename: rdbPath, loaded: true, exports: {
  enabled: false,
  pushPixelLog: async (row) => { emqByEvent[row.eventId] = { emq: row.emq, fields: row.emqFields }; },
  bumpEmq: async () => {}, loadPixelLog: async () => [],
  loadCapiRetryQueue: async () => [], saveCapiRetryQueue: async () => {},
  acquireLock: async () => true, releaseLock: async () => {}
}};

let sent = [];
global.fetch = async (url, opts) => {
  sent.push(JSON.parse(opts.body));
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

const ttEvents = require('../tiktok-events');

// Reproduz EXATAMENTE o payload que processConversion monta (server.js ~2086).
function capiPayload(n, lead) {
  return {
    _trusted: true,
    eventId: n.event + '.' + n.gateway + '.' + n.orderId,
    email: n.email || (lead && lead.email) || undefined,
    phone: n.phone || (lead && lead.phone) || undefined,
    leadId: lead ? lead.id : undefined,                     // → external_id = hash(v_id)
    externalId: lead ? undefined : (n.email || n.orderId),  // órfã: external_id do email/pedido
    ip: (lead && lead.ip) || undefined,
    userAgent: (lead && lead.ua) || undefined,
    ttclid: (lead && lead.ttclid) || undefined,
    ttp: (lead && lead.ttp) || undefined,
    value: n.amountCents ? n.amountCents / 100 : undefined,
    currency: n.currency
  };
}

(async () => {
  // Lead do funil enriquecido pelo clique no /go (ttclid) + checkout (email/phone)
  const lead = {
    id: VID, acc: ACC, email: 'comprador@ex.com', phone: '+351912345678',
    ttclid: 'TTCLID_from_ad_click', ip: '203.0.113.7',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) Mobile/15E148'
  };

  // ── ÓRFÃ (ANTES do fix): vid não casava → sem lead, só identidade do webhook ──
  const orfaPayload = capiPayload(kiwify, null);
  await ttEvents.dispatchToAll('CompletePayment', orfaPayload, '*', ACC);
  const orfa = emqByEvent[orfaPayload.eventId];

  // ── CASADA (DEPOIS do fix): vid casa o lead → identidade completa ──
  const casadaPayload = capiPayload(kiwify, lead);
  await ttEvents.dispatchToAll('CompletePayment', casadaPayload, '*', ACC);
  const casada = emqByEvent[casadaPayload.eventId];

  console.log('  EMQ ÓRFÃ  (antes):', orfa.emq, '/10  campos:', orfa.fields.join(', '));
  console.log('  EMQ CASADA (depois):', casada.emq, '/10  campos:', casada.fields.join(', '));

  // external_id presente nos dois; casada é muito maior e traz ttclid
  const orfaUser = sent[0].data[0].user;
  const casadaUser = sent[1].data[0].user;
  assert.ok(orfaUser.external_id, 'órfã: external_id presente (do email/pedido)');
  assert.ok(!orfaUser.ttclid, 'órfã: sem ttclid (não casou o clique)');
  assert.ok(casadaUser.external_id, 'casada: external_id presente (hash do v_id)');
  assert.ok(casadaUser.ttclid, 'casada: ttclid presente (clique atribuído)');
  assert.ok(casada.emq >= 8, 'casada: EMQ alto (>=8), esperado ~9');
  assert.ok(casada.emq > orfa.emq, 'EMQ da casada deve superar a órfã');

  console.log('[OK] Parte B — EMQ sobe de ' + orfa.emq + ' (órfã) para ' + casada.emq + ' (casada) com o vid atribuído.');
  process.exit(0);
})().catch((e) => { console.error('[FALHOU]', e.message); process.exit(1); });
