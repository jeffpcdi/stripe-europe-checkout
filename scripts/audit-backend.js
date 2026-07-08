'use strict';
// Auditoria funcional dos módulos puros do backend (sem DB/HTTP).
// Executa: node scripts/audit-backend.js
const assert = require('assert');
const path = require('path');
process.chdir(path.join(__dirname, '..'));

let pass = 0, fail = 0;
const fails = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; fails.push({ name, msg: e.message }); console.log('  FAIL ' + name + ' -> ' + e.message); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ok  ' + name); }
  catch (e) { fail++; fails.push({ name, msg: e.message }); console.log('  FAIL ' + name + ' -> ' + e.message); }
}

(async () => {
  // ─── 1. Normalização de webhooks multi-gateway ───────────────────────────
  console.log('\n[1] conversion-normalize (webhooks multi-gateway)');
  const cn = require('../conversion-normalize');

  test('Kiwify: paid + trackingParameters.src vira CompletePayment com leadId', () => {
    const r = cn.normalizeConversion({
      webhook_event_type: 'order_approved',
      order_status: 'paid',
      order_id: 'KW123',
      Commissions: { charge_amount: 4990 },
      Customer: { email: 'a@b.com', full_name: 'Joao' },
      trackingParameters: { src: 'vid_abc' }
    }, {});
    assert.equal(r.event, 'CompletePayment');
    assert.equal(r.orderId, 'KW123');
    assert.equal(r.amountCents, 4990, 'charge_amount ja em centavos');
    assert.equal(r.leadId, 'vid_abc');
    assert.equal(r.email, 'a@b.com');
  });

  test('ACHADO: precedencia sck>src no leadId (bug potencial de atribuicao)', () => {
    // Kiwify pode mandar sck (checkout key) E src (vid). O normalizer atual
    // usa `... || b.s1 || b.sck || b.src` -> sck vence src. Se o app injeta o
    // vid em src, um sck preenchido pela Kiwify sequestra a atribuicao.
    const r = cn.normalizeConversion({
      order_status: 'paid', order_id: 'K2', Commissions: { charge_amount: 100 },
      trackingParameters: { src: 'vid_correto', sck: 'ref_kiwify' }
    }, {});
    assert.equal(r.leadId, 'ref_kiwify', 'comportamento ATUAL: sck ganha de src');
  });

  test('Stripe: envelope passa por adaptPayload antes do normalizer (fluxo /hook)', () => {
    const gw = require('../gateway-store');
    const adapted = gw.adaptPayload('stripe', {
      type: 'checkout.session.completed',
      data: { object: {
        id: 'cs_test_1',
        amount_total: 9990,           // Stripe ja manda centavos
        currency: 'eur',
        client_reference_id: 'vid_stripe',
        customer_details: { email: 's@t.com' }
      } }
    });
    const r = cn.normalizeConversion(adapted, { gateway: 'stripe' });
    assert.equal(r.event, 'CompletePayment');
    assert.equal(r.amountCents, 9990, 'amount_cents preservado');
    assert.equal(r.leadId, 'vid_stripe');
    assert.equal(r.email, 's@t.com');
  });

  test('PerfectPay: metadata.src sobe para leadId', () => {
    const r = cn.normalizeConversion({
      sale_status_detail: 'approved',
      transaction: 'PP-1',
      total: '149,90',
      metadata: { src: 'vid_pp' },
      customer_email: 'c@d.com'
    }, {});
    assert.equal(r.event, 'CompletePayment');
    assert.equal(r.amountCents, 14990, 'aceita virgula decimal BR');
    assert.equal(r.leadId, 'vid_pp');
  });

  test('Refund e Dispute sao mapeados', () => {
    assert.equal(cn.mapConversionEvent('refunded'), 'Refund');
    assert.equal(cn.mapConversionEvent('chargeback'), 'Dispute');
    assert.equal(cn.mapConversionEvent('reembolso'), 'Refund');
  });

  test('evento nao reconhecido retorna erro', () => {
    const r = cn.normalizeConversion({ type: 'ping', id: '1' }, {});
    assert.ok(r.error, 'deve rejeitar');
  });

  test('CompletePayment sem valor eh rejeitado', () => {
    const r = cn.normalizeConversion({ status: 'paid', id: 'X1' }, {});
    assert.ok(r.error && /amount/.test(r.error));
  });

  test('parseAmount lida com R$ 1.234,56 e 1,234.56', () => {
    assert.equal(cn.parseAmount('R$ 1.234,56'), 1234.56);
    assert.equal(cn.parseAmount('1,234.56'), 1234.56);
    assert.equal(cn.parseAmount(49.9), 49.9);
  });

  test('flatten resolve conflito product.name vs buyer.name', () => {
    const f = cn.flattenGatewayPayload({
      product: { name: 'Curso X' },
      buyer: { name: 'Maria' }
    });
    assert.equal(f.product_name, 'Curso X');
    assert.equal(f.name, 'Maria', 'nome do topo/buyer vence');
  });

  // ─── 2. CAPI / TikTok Events (hashing, EMQ, gateway-only) ────────────────
  console.log('\n[2] tiktok-events (CAPI / pixel server-side)');
  const tt = require('../tiktok-events');

  test('hash SHA-256 normaliza (trim+lowercase)', () => {
    const h = tt.hash('  Test@Email.COM ');
    assert.match(h, /^[a-f0-9]{64}$/);
    assert.equal(h, tt.hash('test@email.com'), 'normalizacao consistente');
  });

  test('hashPhone normaliza para E.164 antes do hash', () => {
    const a = tt.hashPhone('+55 (11) 99999-8888');
    const b = tt.hashPhone('005511999998888');
    assert.match(a, /^[a-f0-9]{64}$/);
    assert.equal(a, b, '00 internacional vira + equivalente');
  });

  test('hashPhone rejeita telefone fora do E.164', () => {
    assert.equal(tt.hashPhone('123'), undefined, 'curto demais');
    assert.equal(tt.hashPhone('1'.repeat(20)), undefined, 'longo demais');
  });

  test('externalIdFromLead deriva external_id estavel', () => {
    const e = tt.externalIdFromLead('vid_1');
    assert.equal(e, tt.externalIdFromLead('vid_1'));
    assert.equal(tt.externalIdFromLead(''), undefined);
  });

  await atest('gateway-only: CompletePayment sem _trusted eh BLOQUEADO', async () => {
    const r = await tt.dispatchToAll('CompletePayment', { eventId: 'e1', leadId: 'l1' }, '*', 'accX');
    assert.equal(r.dispatched, 0);
    assert.equal(r.blocked, 'gateway-only');
  });

  await atest('evento nao-monetario passa da trava gateway-only', async () => {
    // sem pixels cadastrados -> dispatched 0, mas NAO bloqueado
    const r = await tt.dispatchToAll('ViewContent', { eventId: 'e2' }, '*', 'accX');
    assert.notEqual(r.blocked, 'gateway-only');
  });

  // ─── 3. Cloaking / bot-filter (challenge token, judge) ───────────────────
  console.log('\n[3] bot-filter (cloaking / anti-revisor TikTok)');
  const bf = require('../bot-filter');

  test('challenge token: emite e verifica com sucesso', () => {
    const tok = bf.issueChallengeToken('vid_1', 60000);
    assert.ok(tok);
    assert.equal(bf.verifyChallengeToken('vid_1', tok).ok, true);
  });

  test('challenge token: rejeita vid trocado', () => {
    const tok = bf.issueChallengeToken('vid_1', 60000);
    assert.equal(bf.verifyChallengeToken('vid_2', tok).ok, false);
  });

  test('challenge token: rejeita token expirado', () => {
    const tok = bf.issueChallengeToken('vid_1', -1000);
    const r = bf.verifyChallengeToken('vid_1', tok);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'expirado');
  });

  test('challenge token: rejeita lixo sem lancar excecao', () => {
    assert.equal(bf.verifyChallengeToken('vid', 'lixo').ok, false);
    assert.equal(bf.verifyChallengeToken('vid', '').ok, false);
    assert.equal(bf.verifyChallengeToken('', 'x.y').ok, false);
  });

  await atest('judge: curl-like (sem headers de browser) = bot', async () => {
    const fakeReq = { headers: { 'user-agent': 'curl/8.0' }, socket: { remoteAddress: '1.2.3.4' } };
    const v = await bf.judge(fakeReq, 'vid_1', '', {}, { blockDatacenter: false });
    assert.ok(v.score >= 40, 'score alto esperado, veio ' + v.score);
    assert.equal(v.verdict, 'bot');
  });

  await atest('judge: browser real (headers completos + token) = real', async () => {
    const tok = bf.issueChallengeToken('vid_real', 60000);
    const fakeReq = { headers: {
      'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'accept': 'text/html,application/xhtml+xml',
      'accept-language': 'pt-BR,pt;q=0.9',
      'sec-fetch-site': 'none', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document',
      'referer': 'https://www.tiktok.com/'
    }, socket: { remoteAddress: '5.6.7.8' } };
    const v = await bf.judge(fakeReq, 'vid_real', tok, { webgl: 'Apple GPU', tz: 'America/Sao_Paulo' }, { blockDatacenter: false, checkTimezone: false });
    assert.equal(v.verdict, 'real', 'esperava real, score ' + v.score + ' sinais ' + JSON.stringify(v.signals));
  });

  // ─── 4. A/B de links (bucketing deterministico) ──────────────────────────
  console.log('\n[4] link-store (A/B de checkout)');
  const ls = require('../link-store');

  test('pickVariant eh deterministico por visitante', () => {
    const link = { slug: 'oferta', variantes: [
      { id: 'a', peso: 50, url: 'https://x.com/a' },
      { id: 'b', peso: 50, url: 'https://x.com/b' }
    ]};
    const p1 = ls.pickVariant(link, 'visitante-42').id;
    const p2 = ls.pickVariant(link, 'visitante-42').id;
    assert.equal(p1, p2, 'mesmo visitante -> mesma variante');
  });

  test('pickVariant respeita pesos (100/0 -> sempre A)', () => {
    const link = { slug: 'o2', variantes: [
      { id: 'a', peso: 100, url: 'https://x.com/a' },
      { id: 'b', peso: 0, url: 'https://x.com/b' }
    ]};
    for (let i = 0; i < 20; i++) {
      assert.equal(ls.pickVariant(link, 'v' + i).id, 'a');
    }
  });

  test('distribuicao 50/50 fica dentro de tolerancia em 2000 visitantes', () => {
    const link = { slug: 'o3', variantes: [
      { id: 'a', peso: 50, url: 'https://x.com/a' },
      { id: 'b', peso: 50, url: 'https://x.com/b' }
    ]};
    let a = 0;
    for (let i = 0; i < 2000; i++) if (ls.pickVariant(link, 'user-' + i).id === 'a') a++;
    const ratio = a / 2000;
    assert.ok(ratio > 0.42 && ratio < 0.58, 'split fora da faixa: ' + ratio);
  });

  test('slugify normaliza acentos e espacos', () => {
    assert.equal(ls.slugify('Minha Oferta Incrível!'), 'minha-oferta-incrivel');
  });

  // ─── 5. UA detection (in-app TikTok, crawlers) ───────────────────────────
  console.log('\n[5] ua (deteccao in-app TikTok / device)');
  const ua = require('../ua');
  test('isInAppTikTok detecta webview do TikTok', () => {
    assert.equal(ua.isInAppTikTok('Mozilla/5.0 ... musical_ly_2023 BytedanceWebview/d8a21c'), true);
    assert.equal(ua.isInAppTikTok('Mozilla/5.0 (iPhone) Safari/604.1'), false);
  });

  // ─── Resultado ────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════');
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  console.log('══════════════════════════════════════');
  if (fail) { console.log('\nFalhas:'); fails.forEach((f) => console.log('  - ' + f.name + ': ' + f.msg)); }
  process.exit(fail ? 1 : 0);
})();
