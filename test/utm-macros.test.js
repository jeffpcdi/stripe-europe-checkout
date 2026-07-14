'use strict';
/*
 * Fase 1 — sanitização de macros de UTM. O TikTok só substitui __CAMPAIGN_NAME__
 * & cia na entrega REAL; preview/bot/direto chegam com a macro literal e
 * poluíam o ranking de campanhas. A regra é case-sensitive de propósito: se
 * ela virar case-insensitive, nomes legítimos (MINHA_CAMPANHA) somem do
 * relatório. Cada caso aqui protege o ranking do operador.
 */
const assert = require('assert');
const { isUtmMacro, buildUtm } = require('../utm-macros');

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
  console.log('  ✓ ' + label);
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + JSON.stringify(expected) + ', veio ' + JSON.stringify(actual));
  n++;
  console.log('  ✓ ' + label);
}

console.log('isUtmMacro — reconhece macros do TikTok não substituídas');
ok(isUtmMacro('__CAMPAIGN_NAME__'), '__CAMPAIGN_NAME__ é macro');
ok(isUtmMacro('__CAMPAIGN_ID__'), '__CAMPAIGN_ID__ é macro');
ok(isUtmMacro('__AID__'), '__AID__ é macro');
ok(isUtmMacro('__PLACEMENT__'), '__PLACEMENT__ é macro');
ok(isUtmMacro('__CID__'), '__CID__ é macro');
ok(isUtmMacro('utm__CAMPAIGN_NAME__'), 'macro colada a prefixo ainda é detectada');

console.log('isUtmMacro — NÃO descarta nomes legítimos');
ok(!isUtmMacro('promo_black_friday'), 'promo_black_friday é campanha real');
ok(!isUtmMacro('verao_2024'), 'verao_2024 é campanha real');
ok(!isUtmMacro('MINHA_CAMPANHA'), 'MINHA_CAMPANHA (sem __) é campanha real');
ok(!isUtmMacro('__minuscula__'), '__minuscula__ não casa (case-sensitive)');
ok(!isUtmMacro('__Campaign_Name__'), '__Campaign_Name__ (misto) não casa');
ok(!isUtmMacro(''), 'string vazia não é macro');
ok(!isUtmMacro(null), 'null não é macro');
ok(!isUtmMacro(undefined), 'undefined não é macro');
ok(!isUtmMacro(123), 'número não é macro');

console.log('buildUtm — anula macro no campaign e preserva auditoria');
const m = buildUtm({ source: 'tiktok', medium: 'cpc', campaign: '__CAMPAIGN_NAME__', content: 'ad1', term: null });
eq(m.campaign, null, 'campaign macro vira null');
eq(m.campaignRaw, '__CAMPAIGN_NAME__', 'valor cru preservado em campaignRaw (auditoria)');
eq(m.source, 'tiktok', 'source preservado');
eq(m.medium, 'cpc', 'medium preservado');
eq(m.content, 'ad1', 'content preservado');
eq(m.term, null, 'term ausente vira null');

console.log('buildUtm — campanha legítima passa intacta');
const g = buildUtm({ source: 'ig', campaign: 'promo_black_friday' });
eq(g.campaign, 'promo_black_friday', 'campanha real intacta');
ok(!('campaignRaw' in g), 'sem campaignRaw quando não há macro');

console.log('buildUtm — entrada vazia/ausente não quebra');
const e = buildUtm();
eq(e.campaign, null, 'sem src: campaign null');
eq(e.source, null, 'sem src: source null');

console.log('\nutm-macros: ' + n + ' asserts OK');
