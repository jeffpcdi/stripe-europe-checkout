'use strict';
/*
 * Advanced Matching (EMQ) — e-mail/telefone do comprador no CompletePayment são
 * o sinal de match mais forte. Se o normalize não achar a PII quando o gateway
 * a aninha fundo, o evento de dinheiro sai com EMQ baixo e o TikTok não atribui
 * a compra. Cada caso aqui é um formato REAL de gateway; se algum falhar, o EMQ
 * cai e as conversões somem do painel — trate como incidente.
 */
const assert = require('assert');
const { normalizeConversion } = require('../conversion-normalize');

let n = 0;
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + JSON.stringify(expected) + ', veio ' + JSON.stringify(actual));
  n++;
  console.log('  ✓ ' + label);
}

console.log('normalizeConversion — PII na raiz (comportamento antigo, ainda vale)');
let r = normalizeConversion({ event: 'paid', order_id: '1', amount: 49.9, email: 'a@b.com', phone: '+5511999998888' });
eq(r.email, 'a@b.com', 'email na raiz');
eq(r.phone, '+5511999998888', 'phone na raiz');

console.log('normalizeConversion — PII aninhada em container conhecido (Kiwify Customer)');
r = normalizeConversion({ webhook_event_type: 'order_approved', order_id: '2', charge_amount: 4990, Customer: { email: 'kiwi@buyer.com', mobile: '11988887777' } });
eq(r.email, 'kiwi@buyer.com', 'email em Customer.email');
eq(r.phone, '11988887777', 'phone em Customer.mobile');

console.log('normalizeConversion — PII aninhada FUNDO em container desconhecido (Stripe customer_details)');
r = normalizeConversion({ type: 'checkout.session.completed', id: 'cs_1', data: { object: { total: 29.97, customer_details: { email: 'nested@stripe.com', phone: '+14155550100' } } } });
eq(r.email, 'nested@stripe.com', 'email em data.object.customer_details.email (recursivo)');
eq(r.phone, '+14155550100', 'phone recursivo fundo');

console.log('normalizeConversion — aliases PT-BR (payer_email / celular)');
r = normalizeConversion({ status: 'aprovado', transaction_id: '3', value: '97,00', sender: { payer_email: 'br@pagseguro.com', celular: '(11) 97777-6666' } });
eq(r.email, 'br@pagseguro.com', 'alias payer_email aninhado');
eq(r.phone, '(11) 97777-6666', 'alias celular aninhado');

console.log('normalizeConversion — PII dentro de array (charges[].billing_details)');
r = normalizeConversion({ event: 'paid', order_id: 'array-1', amount: 10, charges: [{ billing_details: { email: 'array@buyer.com', phone: '+351912345678' } }] });
eq(r.email, 'array@buyer.com', 'email dentro de array');
eq(r.phone, '+351912345678', 'telefone dentro de array');

console.log('normalizeConversion — descarta lixo (email inválido, telefone curto)');
r = normalizeConversion({ event: 'paid', order_id: '4', amount: 10, email: 'nao-eh-email', phone: '0' });
eq(r.email, null, 'string sem @ não é e-mail');
eq(r.phone, null, 'telefone com <7 dígitos é descartado');

console.log('normalizeConversion — raiz vence sobre ocorrência mais funda (afiliado/comissão)');
r = normalizeConversion({ event: 'paid', order_id: '5', amount: 10, email: 'comprador@top.com', commissions: { affiliate: { email: 'afiliado@fundo.com' } } });
eq(r.email, 'comprador@top.com', 'e-mail da raiz vence o do afiliado aninhado');
r = normalizeConversion({ event: 'paid', order_id: '6', amount: 10, customer_email: 'raiz@buyer.com', commissions: { affiliate: { email: 'afiliado@fundo.com' } } });
eq(r.email, 'raiz@buyer.com', 'alias da raiz vence alias genérico mais fundo');

console.log('\n✅ conversion-pii: ' + n + ' asserts OK');

// O identificador da jornada deve vencer códigos de checkout de outros sistemas.
{
  const { pickLeadId } = require('../conversion-normalize');
  const assertLead = require('node:assert/strict');
  assertLead.equal(pickLeadId({ sck: 'checkout-externo', src: 'ld_abc123456' }), 'ld_abc123456');
  assertLead.equal(pickLeadId({ visitor_id: 'v_abc123456', src: 'campanha' }), 'v_abc123456');
  assertLead.equal(pickLeadId({ leadId: 'legado', src: 'campanha' }), 'legado');
  assertLead.equal(pickLeadId({}), null);
}
