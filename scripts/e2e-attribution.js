/**
 * Simulação END-TO-END da atribuição TikTok Ads (in-process, sem tocar produção).
 *
 * Roda os MÓDULOS REAIS (conversion-normalize, stats, pixel-store, tiktok-events)
 * com db/redis DESLIGADOS (memória local) e o fetch da CAPI STUBADO para capturar
 * o payload que iria ao TikTok. Reproduz o fluxo real:
 *
 *   clique com ttclid → /go (semeia lead + injeta src=vid) → checkout →
 *   POST /hook/:token com payload Kiwify (TrackingParameters.src=vid) →
 *   match, purchased, CompletePayment na CAPI com external_id + EMQ.
 *
 * Compara o ANTES (venda órfã, sem o vid ecoado) com o DEPOIS (venda casada).
 *
 * Uso: node scripts/e2e-attribution.js   (NÃO carregue o .env de produção)
 */
'use strict';

// ── 0. Garante ambiente isolado (memória local; nada vai para Neon/Redis) ────
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;
delete process.env.REDIS_URL;
delete process.env.KV_URL;
delete process.env.UPSTASH_REDIS_REST_URL;

// ── 1. Stub do fetch: captura o payload da CAPI e responde como o TikTok (ok) ─
const capiCalls = [];
global.fetch = async (url, opts) => {
  let body = {};
  try { body = JSON.parse((opts && opts.body) || '{}'); } catch (_) {}
  capiCalls.push({ url: String(url), body, accessToken: opts && opts.headers && opts.headers['Access-Token'] });
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

const stats = require('../stats');
const pixelStore = require('../pixel-store');
const ttEvents = require('../tiktok-events');
const { normalizeConversion } = require('../conversion-normalize');

const ACC = 'acc_e2e';
const VID = 'ld_e2e_vid_abc123';
const TTCLID = 'E.C.P.' + 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4'; // string longa como o TikTok
const IP = '203.0.113.45';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_2023.5.0';
const EMAIL = 'cliente@exemplo.com';
const PHONE = '+351912345678';

function fields(call) {
  const u = (call.body.data && call.body.data[0] && call.body.data[0].user) || {};
  return Object.keys(u).filter((k) => u[k] != null && u[k] !== '');
}
function emqFor(pixelSlug) {
  // O log registra o nome OUTBOUND ('Purchase'); 'CompletePayment' fica como
  // compat para logs antigos.
  const row = ttEvents.recentLog(20, ACC).find((r) => r.pixel === pixelSlug && (r.event === 'Purchase' || r.event === 'CompletePayment'));
  return row ? { score: row.emq, sinais: row.emqFields } : null;
}
function externalIdOf(call) {
  const u = (call.body.data && call.body.data[0] && call.body.data[0].user) || {};
  return u.external_id || null;
}

async function main() {
  // ── Setup: registra um pixel de teste para a conta ────────────────────────
  await pixelStore.save(ACC, {
    name: 'Pixel E2E', slug: 'pixel-e2e',
    pixelCode: 'PIXEL_E2E_CODE', accessToken: 'ACCESS_TOKEN_E2E',
    active: true, events: { CompletePayment: true }
  });

  // Espelha exatamente o processConversion do server: resolve o lead, marca a
  // venda e dispara a CAPI com a identidade do lead (ou órfã).
  async function processWebhook(rawBody, label) {
    const n = normalizeConversion(rawBody, { gateway: 'kiwify' });
    n.acc = ACC;
    if (n.error) { console.log(label, 'ERRO normalize:', n.error); return null; }
    const lead = stats.matchExternalConversion(n);
    const evId = 'Evento.' + (lead ? lead.id : n.orderId) + '.' + new Date().toISOString().slice(0, 13).replace(/[-T]/g, '');
    await ttEvents.dispatchToAll('CompletePayment', {
      _trusted: true,
      eventId: evId,
      email: n.email || (lead && lead.email) || undefined,
      phone: n.phone || (lead && lead.phone) || undefined,
      leadId: lead ? lead.id : undefined,
      externalId: lead ? undefined : (n.email || n.orderId),
      ip: (lead && lead.ip) || undefined,
      userAgent: (lead && lead.ua) || undefined,
      ttclid: (lead && lead.ttclid) || undefined,
      value: n.amountCents ? n.amountCents / 100 : undefined,
      currency: n.currency,
      contents: n.product ? [{ content_id: 'p', content_name: n.product, price: n.amountCents / 100, quantity: 1 }] : undefined
    }, '*', ACC);
    return { n, lead, resolvedLeadId: n.leadId };
  }

  // ══════════ CENÁRIO ANTES: /go NÃO injetava src → venda órfã ══════════════
  // Webhook Kiwify sem qualquer parâmetro de tracking ecoado (o vid não chegou).
  const kiwifyOrphan = {
    webhook_event_type: 'order_approved',
    order_id: 'KWY-0001',
    Customer: { email: EMAIL, full_name: 'Cliente Exemplo' },
    Commissions: { charge_amount: 9700 }, // centavos
    TrackingParameters: { src: null, sck: null, utm_source: 'tiktok' }
  };
  capiCalls.length = 0;
  const before = await processWebhook(kiwifyOrphan, '[ANTES]');
  const beforeCall = capiCalls[capiCalls.length - 1];
  const beforeEmq = emqFor('pixel-e2e');

  // ══════════ CENÁRIO DEPOIS: /go injeta src=vid → venda casada ═════════════
  // 1) clique real com ttclid: /go semeia o lead (recordCheckoutEntry) com
  //    ttclid + ip + ua sob o vid — exatamente como a rota faz na linha 815.
  stats.recordCheckoutEntry(VID, 'link:promo-tiktok', {
    acc: ACC, ttclid: TTCLID, ip: IP, ua: UA, linkSlug: 'promo-tiktok'
  });
  // 2) checkout gera PIX: gateway manda email/phone no InitiateCheckout (enriquece)
  stats.recordCheckoutEntry(VID, 'kiwify', { acc: ACC, email: EMAIL, phone: PHONE });
  // 3) venda aprovada: Kiwify ECOA o vid em TrackingParameters.src (novo /go)
  const kiwifyMatched = {
    webhook_event_type: 'order_approved',
    order_id: 'KWY-0002',
    Customer: { email: EMAIL, full_name: 'Cliente Exemplo' },
    Commissions: { charge_amount: 9700 },
    TrackingParameters: { src: VID, sck: VID, s1: VID, utm_source: 'tiktok' }
  };
  capiCalls.length = 0;
  const after = await processWebhook(kiwifyMatched, '[DEPOIS]');
  const afterCall = capiCalls[capiCalls.length - 1];
  const afterEmq = emqFor('pixel-e2e');

  // ── Relatório ─────────────────────────────────────────────────────────────
  const line = (s) => console.log(s);
  line('\n================ SIMULAÇÃO END-TO-END: ATRIBUIÇÃO TikTok ================\n');

  line('ANTES (o /go NÃO injetava src/sck/s1 → o vid não voltava no webhook):');
  line('  • normalize.leadId resolvido do webhook : ' + JSON.stringify(before.resolvedLeadId));
  line('  • venda casou com lead?                 : ' + (before.lead && !before.lead.orphan ? 'SIM' : 'NÃO (órfã)'));
  line('  • lead.orphan                           : ' + (before.lead ? before.lead.orphan : '(n/a)'));
  line('  • CAPI external_id                      : ' + JSON.stringify(externalIdOf(beforeCall)));
  line('  • CAPI sinais de identidade (user{})    : ' + JSON.stringify(fields(beforeCall)));
  line('  • EMQ (Event Match Quality)             : ' + (beforeEmq ? beforeEmq.score + '/10  ' + JSON.stringify(beforeEmq.sinais) : '(sem log)'));

  line('\nDEPOIS (o /go injeta src=vid; Kiwify ECOA em TrackingParameters.src):');
  line('  • normalize.leadId resolvido do webhook : ' + JSON.stringify(after.resolvedLeadId) + '   ← veio do src aninhado (flatten)');
  line('  • venda casou com lead?                 : ' + (after.lead && !after.lead.orphan ? 'SIM' : 'NÃO'));
  line('  • lead.id                               : ' + (after.lead ? after.lead.id : '(n/a)'));
  line('  • lead.stage                            : ' + (after.lead ? after.lead.stage : '(n/a)'));
  line('  • lead.orphan                           : ' + (after.lead ? after.lead.orphan : '(n/a)'));
  line('  • CAPI external_id (hash do vid)        : ' + JSON.stringify(externalIdOf(afterCall)) + '  (preenchido)');
  line('  • CAPI sinais de identidade (user{})    : ' + JSON.stringify(fields(afterCall)));
  line('  • EMQ (Event Match Quality)             : ' + (afterEmq ? afterEmq.score + '/10  ' + JSON.stringify(afterEmq.sinais) : '(sem log)'));

  const b = beforeEmq ? beforeEmq.score : 0, a = afterEmq ? afterEmq.score : 0;
  line('\nRESULTADO: EMQ subiu de ' + b + '/10 (órfã) para ' + a + '/10 (casada)  →  +' + (a - b) + ' pontos.');
  line('=========================================================================\n');

  // ── Asserções: falha (exit 1) se a correção não estiver funcionando ────────
  const problems = [];
  if (!(before.lead && before.lead.orphan)) problems.push('ANTES deveria ser órfã');
  if (!(after.lead && !after.lead.orphan)) problems.push('DEPOIS deveria casar (não-órfã)');
  if (!(after.lead && after.lead.stage === 'purchased')) problems.push('DEPOIS deveria estar purchased');
  if (!externalIdOf(afterCall)) problems.push('DEPOIS deveria ter external_id na CAPI');
  if (!(a > b)) problems.push('EMQ deveria subir de órfã para casada');
  if (after.resolvedLeadId !== VID) problems.push('flatten deveria extrair src=vid do TrackingParameters');

  if (problems.length) { console.error('FALHOU:\n - ' + problems.join('\n - ')); process.exit(1); }
  console.log('OK — todas as asserções do E2E passaram.\n');
  process.exit(0);
}

main().catch((e) => { console.error('E2E erro:', e); process.exit(1); });
