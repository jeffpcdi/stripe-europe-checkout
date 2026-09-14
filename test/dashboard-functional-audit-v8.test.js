'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const api = read('dashboard/lib/api.ts');
const cache = read('dashboard/lib/cache-consistency.ts');
const tiktok = read('dashboard/components/ads/tiktok-ads-view.tsx');
const automation = read('dashboard/components/ads/automation-panel.tsx');
const inbox = read('dashboard/components/ads/needs-you-inbox.tsx');
const decide = read('dashboard/components/overview/decide-strip.tsx');
const pixels = read('dashboard/components/pixels/pixels-view.tsx');
const gateways = read('dashboard/components/gateways/gateways-view.tsx');
const conversions = read('dashboard/components/conversions/conversions-view.tsx');

console.log('Auditoria funcional V8 — contexto dinâmico sem dados anteriores');
assert.match(api, /export function useLead[\s\S]*?keepPreviousData: false/,
  'drawer de lead não pode reaproveitar PII do lead anterior durante troca de chave');
assert.match(api, /export function useCloakDecisions[\s\S]*?keepPreviousData: false/,
  'log de Cloak não pode mostrar decisões do link anterior durante troca de chave');
assert.match(cache, /export function apiCacheKeyMatches/,
  'revalidação cruzada deve usar um predicado único de chave de API');

console.log('Auditoria funcional V8 — TikTok Ads consistente entre telas');
assert.match(tiktok, /accounts\?\.selected === advertiserId[\s\S]*?setAdvertiserId\(null\)/,
  'override local do advertiser deve ser liberado após confirmação do cache');
assert.match(tiktok, /Promise\.allSettled\(\[mutateAccounts\(\), mutateStatus\(\)\]\)/,
  'troca de advertiser deve atualizar também o status consumido pela Overview');
assert.match(tiktok, /function refreshCampaignSurfaces\(\)[\s\S]*?mutateTree\(\)[\s\S]*?mutateDecisions\(\)[\s\S]*?mutateSyncStatus\(\)/,
  'mutações de campanha devem atualizar árvore, decisões e sync juntos');
assert.match(tiktok, /'\/api\/ads\/campaign-decisions'/,
  'refresh manual deve incluir o modelo de decisão derivado');

console.log('Auditoria funcional V8 — automação e propostas');
assert.match(automation, /refreshAutomationDependents\(options:[\s\S]*?'\/api\/ads\/campaign-decisions'/,
  'mudanças de automação devem invalidar decisões derivadas');
assert.match(automation, /refreshAutomationDependents\(\{ campaigns: executed\.some[\s\S]*?proposals: true \}\)/,
  'avaliar agora deve atualizar propostas e campanhas quando houver ação real');
assert.match(automation, /refreshAutomationDependents\(\{ alerts: true \}\)/,
  'alertas editados devem atualizar o cache separado usado pela caixa de atenção');
assert.match(inbox, /refreshAfterDecision\(\)[\s\S]*?'\/api\/ads\/campaign-decisions'[\s\S]*?'\/api\/ads\/rules'[\s\S]*?'\/api\/ads\/tree'/,
  'aprovar/rejeitar na aba Ads deve atualizar decisões, histórico e campanha');
assert.match(decide, /refreshAfterDecision\(\)[\s\S]*?'\/api\/ads\/campaign-decisions'[\s\S]*?'\/api\/ads\/rules'[\s\S]*?'\/api\/ads\/tree'/,
  'aprovar/rejeitar na Overview deve atualizar as mesmas fontes');

console.log('Auditoria funcional V8 — Pixels, Gateways e saúde derivada');
for (const [name, source, helper] of [
  ['Pixels', pixels, 'refreshPixelDependents'],
  ['Gateways', gateways, 'refreshGatewayDependents'],
  ['Conversões', conversions, 'refreshConversionDependents'],
]) {
  assert.match(source, new RegExp(`function ${helper}|const ${helper}`), `${name}: deve ter revalidação de dependências`);
  assert.match(source, /'\/api\/pixels\/health'/, `${name}: saúde de Pixels deve acompanhar mutações`);
  assert.match(source, /'\/api\/pixels\/durability'/, `${name}: diagnóstico de persistência deve acompanhar mutações`);
  assert.match(source, /'\/api\/overview\/health'/, `${name}: Overview não deve esperar polling após mudança operacional`);
}

console.log('dashboard-functional-audit-v8: OK');
