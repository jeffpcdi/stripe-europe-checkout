'use strict';

// Regressão do caso real: dois pixels na mesma conta não podem receber o
// evento um do outro. Cobre navegador/CAPI, dedup por destino, vendas sem
// vínculo e o JS entregue para páginas externas.
const assert = require('assert');

const ACC = 'acc-isolada';
function pixel(slug, code) {
  return {
    slug, acc: ACC, token: 'px_token_' + slug, name: slug,
    pixelCode: code, accessToken: 'TOKEN_' + slug, active: true,
    gatewayIds: [], routes: ['*'],
    events: { ViewContent: true, AddToCart: true, InitiateCheckout: true, AddPaymentInfo: true, CompletePayment: true }
  };
}
const A = pixel('produto-a', 'CODE_A');
const B = pixel('produto-b', 'CODE_B');
const ALL = [A, B];

const psPath = require.resolve('../pixel-store');
require.cache[psPath] = {
  id: psPath, filename: psPath, loaded: true,
  exports: {
    get(acc, slug) { return ALL.find((p) => p.acc === acc && p.slug === slug) || null; },
    getByToken(token) { return ALL.find((p) => p.token === token) || null; },
    list(acc) { return ALL.filter((p) => !acc || p.acc === acc); },
    forEvent(acc, event, route) {
      if (route === '/fora-das-rotas') return [];
      return ALL.filter((p) => p.acc === acc && p.active && p.events[event]);
    },
    forRoute(acc) { return ALL.filter((p) => p.acc === acc && p.active); }
  }
};

const redisPath = require.resolve('../redis');
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true,
  exports: {
    enabled: false,
    loadCapiRetryQueue: async () => [], saveCapiRetryQueue: async () => true,
    pushPixelLog: async () => true, bumpEmq: async () => true,
    acquireLock: async () => true, releaseLock: async () => true,
    seenEventId: async () => false
  }
};

const calls = [];
global.fetch = async (_url, opts) => {
  calls.push(JSON.parse(opts.body));
  return { status: 200, json: async () => ({ code: 0, message: 'OK' }) };
};

const tt = require('../tiktok-events');
const { buildPixelClient } = require('../pixel-client');
const tracker = require('../tracker-view');

(async () => {
  let r = await tt.dispatchScoped('ViewContent', { eventId: 'ViewContent.lead.1' }, '*', ACC, A.slug);
  assert.strictEqual(r.dispatched, 1);
  assert.deepStrictEqual(calls.map((c) => c.event_source_id), ['CODE_A'], 'tag A dispara somente no pixel A');

  // Mesmo event_id em outro Pixel Code é válido: a dedup é por destino.
  r = await tt.dispatchScoped('ViewContent', { eventId: 'ViewContent.lead.1' }, '*', ACC, B.slug);
  assert.strictEqual(r.dispatched, 1);
  assert.deepStrictEqual(calls.map((c) => c.event_source_id), ['CODE_A', 'CODE_B'], 'dedup do pixel A não bloqueia pixel B');

  r = await tt.dispatchScoped('ViewContent', { eventId: 'ViewContent.rota-explicita.1' }, '/fora-das-rotas', ACC, B.slug);
  assert.strictEqual(r.dispatched, 1, 'token explícito não é bloqueado por regra de rota legada');
  assert.strictEqual(calls[calls.length - 1].event_source_id, 'CODE_B');

  r = await tt.dispatchScoped('ViewContent', { eventId: 'ViewContent.lead.1' }, '*', ACC, A.slug);
  assert.strictEqual(r.deduplicated, true, 'repetição no mesmo pixel é deduplicada');

  const beforeAmbiguous = calls.length;
  r = await tt.dispatchScoped('ViewContent', { eventId: 'ViewContent.sem-origem.1' }, '*', ACC);
  assert.strictEqual(r.dispatched, 0);
  assert.strictEqual(r.ambiguous, true);
  assert.strictEqual(calls.length, beforeAmbiguous, 'evento sem origem não faz fan-out');

  r = await tt.dispatchToAll('CompletePayment', {
    _trusted: true, eventId: 'CompletePayment.ambigua', value: 97, currency: 'BRL'
  }, '*', ACC);
  assert.strictEqual(r.dispatched, 0, 'venda com dois pixels livres é bloqueada');

  r = await tt.dispatchToAll('CompletePayment', {
    _trusted: true, pixelSlug: B.slug, eventId: 'CompletePayment.produto-b', value: 97, currency: 'BRL'
  }, '*', ACC);
  assert.strictEqual(r.dispatched, 1);
  assert.strictEqual(calls[calls.length - 1].event_source_id, 'CODE_B', 'pixel persistido no lead vence');

  const client = buildPixelClient(A, A.token);
  assert.ok(client.includes("ttq.instance(CODE)"), 'loader usa instância específica do TikTok');
  assert.ok(client.includes("API+'/api/px/event'"), 'beacon usa origem absoluta da dashboard');
  assert.ok(client.includes('px:TOKEN,vid:vid'), 'beacon leva token e vid explícitos');
  assert.ok(client.includes('roinados_px_outbox_'), 'loader mantém fila local para oscilações de rede');
  assert.ok(client.includes('roinados_ttclid'), 'loader reaproveita ttclid persistido entre páginas');
  assert.ok(client.includes("signalsOnly:true"), 'loader sincroniza _ttp/identidade sem criar outra pageview');
  assert.ok(!client.includes('navigator.sendBeacon("/api/px/event"'), 'não usa endpoint relativo da loja externa');
  assert.ok(tracker.includes("searchParams.get('px')"), 'tracker lê token da própria tag');
  assert.ok(tracker.includes("data-link-domains"), 'tracker suporta passagem explícita entre hospedagens');
  assert.ok(tracker.includes("data-roinados-link"), 'tracker permite marcar só os links autorizados');
  assert.ok(tracker.includes("data-consent"), 'tracker integra com consentimento sem quebrar o padrão existente');
  assert.ok(!tracker.includes("window.ttq.track('ViewContent'"), 'tracker universal não dispara ttq global');

  console.log('[PASS] pixel-isolation: dois pixels isolados no navegador, CAPI, dedup, gateway e script externo.');
})().catch((e) => { console.error('[FAIL]', e.stack || e.message); process.exit(1); });
