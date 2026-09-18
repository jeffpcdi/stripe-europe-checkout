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
const gateways = read('dashboard/components/gateways/gateways-view.tsx');
const conversions = read('dashboard/components/conversions/conversions-view.tsx');

console.log('Auditoria funcional V8 — contexto dinâmico sem dados anteriores');
assert.match(api, /export function useLead[\s\S]*?keepPreviousData: false/);
assert.match(api, /export function useCloakDecisions[\s\S]*?keepPreviousData: false/);
assert.match(cache, /export function apiCacheKeyMatches/);

console.log('Auditoria funcional V8 — TikTok Ads consistente entre telas');
assert.match(tiktok, /accounts\?\.selected === advertiserId[\s\S]*?setAdvertiserId\(null\)/);
assert.match(tiktok, /Promise\.allSettled\(\[mutateAccounts\(\), mutateStatus\(\)\]\)/);
assert.match(tiktok, /function refreshCampaignSurfaces\(\)[\s\S]*?mutateTree\(\)[\s\S]*?mutateDecisions\(\)[\s\S]*?mutateSyncStatus\(\)/);
assert.match(tiktok, /'\/api\/ads\/campaign-decisions'/);

console.log('Auditoria funcional V8 — automação e propostas');
assert.match(automation, /refreshAutomationDependents\(options:[\s\S]*?'\/api\/ads\/campaign-decisions'/);
assert.match(automation, /refreshAutomationDependents\(\{ campaigns: executed\.some[\s\S]*?proposals: true \}\)/);
assert.match(automation, /refreshAutomationDependents\(\{ alerts: true \}\)/);
assert.match(inbox, /refreshAfterDecision\(\)[\s\S]*?'\/api\/ads\/campaign-decisions'[\s\S]*?'\/api\/ads\/rules'[\s\S]*?'\/api\/ads\/tree'/);
assert.match(decide, /refreshAfterDecision\(\)[\s\S]*?'\/api\/ads\/campaign-decisions'[\s\S]*?'\/api\/ads\/rules'[\s\S]*?'\/api\/ads\/tree'/);

console.log('Auditoria funcional V8 — Pixels, Gateways e saúde derivada');
for (const [name, source, helper] of [
  ['Pixels', conversions, 'refreshConversionDependents'],
  ['Gateways', gateways, 'refreshGatewayDependents'],
  ['Conversões', conversions, 'refreshConversionDependents'],
]) {
  assert.match(source, new RegExp(`function ${helper}|const ${helper}`));
  assert.match(source, /'\/api\/pixels\/health'/);
  assert.match(source, /'\/api\/pixels\/durability'/);
  assert.match(source, /'\/api\/overview\/health'/);
}

console.log('dashboard-functional-audit-v8: OK');
