// F6 — capability flags + remoção total da Zernio.
// Contratos verificados por inspeção de código (as rotas exigem servidor +
// auth; aqui garantimos que os contratos honestos não regridem):
// 1. Zero referências à Zernio no runtime (o módulo foi DELETADO — um require
//    esquecido crasharia o servidor no boot).
// 2. GET /status expõe capabilities com os false honestos (cross-account,
//    spark code, custom identity, BC, oauth) — é o que faz a UI ESCONDER
//    em vez de prometer.
// 3. Rotas de conexão têm semântica Pipeboard: connect devolve
//    alreadyConnected/NO_ADVERTISER_VISIBLE, disconnect é 410
//    SERVER_KEY_MANAGED; a rota e o diálogo obsoletos de identidade não existem.
// 4. A UI remove identidade e esconde desconectar via capabilities.
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const routes = fs.readFileSync(path.join(root, 'ads-routes.js'), 'utf8');

// ── 1. Zernio removida do runtime ────────────────────────────────────────────
assert.ok(!fs.existsSync(path.join(root, 'zernio-ads.js')), 'zernio-ads.js foi deletado');
for (const f of ['ads-routes.js', 'ads-provider.js', 'ads-bulk.js', 'ads-ai.js', 'ads-sync.js', 'ads-automation.js']) {
  const p = path.join(root, f);
  if (!fs.existsSync(p)) continue;
  const src = fs.readFileSync(p, 'utf8');
  assert.ok(!/require\(\s*['"]\.\/zernio-ads['"]\s*\)/.test(src), f + ' não importa zernio-ads (require esquecido crasharia o boot)');
}
// O parse do módulo de rotas não pode depender de nada da Zernio:
require(path.join(root, 'ads-routes.js'));
console.log('ok: zernio removida do runtime (require de ads-routes não crasha)');

// ── 2. Capabilities no /status com os "false" honestos ──────────────────────
const statusBlock = routes.split("app.get('/api/ads/status'")[1].split('app.get(')[0];
assert.match(statusBlock, /capabilities:\s*\{/, '/status expõe capabilities');
for (const flag of ['duplicateCrossAccount: false', 'sparkCodeRedeem: false', 'customIdentity: false', 'businessCenters: false', 'oauthConnect: false', 'appPromotion: false']) {
  assert.ok(statusBlock.includes(flag), 'capability honesta presente: ' + flag);
}
for (const flag of ['createCampaign: true', 'bulkCreate: true', 'duplicateSameAccount: true', 'variations: true', 'sparkAds: true']) {
  assert.ok(statusBlock.includes(flag), 'capability implementada presente: ' + flag);
}
console.log('ok: capabilities com true/false honestos no /status');

// ── 3. Semântica Pipeboard nas rotas de conexão ──────────────────────────────
assert.match(routes, /startConnect[\s\S]*?pipeboard\.getStatus/, 'connect consulta o Pipeboard');
assert.match(routes, /NO_ADVERTISER_VISIBLE/, 'connect explica quando não há advertiser (sem URL de OAuth falsa)');
assert.match(routes, /'\/api\/ads\/disconnect'[\s\S]*?410[\s\S]*?SERVER_KEY_MANAGED/, 'disconnect é 410 honesto (chave de servidor)');
assert.ok(!routes.includes("app.patch('/api/ads/identity'"), 'rota obsoleta de identidade foi removida');
assert.ok(!/authUrl: data\.authUrl/.test(routes), 'nenhuma URL de OAuth da Zernio sobrou');
console.log('ok: conexão com semântica Pipeboard (410/422 honestos)');

// ── 4. UI remove o que capabilities nega ─────────────────────────────────────
const view = fs.readFileSync(path.join(root, 'dashboard/components/ads/tiktok-ads-view.tsx'), 'utf8');
assert.ok(!/IdentityDialog|Brand Identity|identityOpen/.test(view), 'menu e diálogo de identidade foram removidos');
assert.ok(!fs.existsSync(path.join(root, 'dashboard/components/ads/identity-dialog.tsx')), 'componente obsoleto de identidade foi removido');
assert.match(view, /capabilities\?\.oauthConnect === false \? null/, 'botão desconectar é condicionado à capability');
const bar = fs.readFileSync(path.join(root, 'dashboard/components/ads/context-bar.tsx'), 'utf8');
assert.match(bar, /onDisconnect: \(\(\) => void\) \| null/, 'context-bar aceita onDisconnect null (esconde botão)');
assert.match(bar, /\{onDisconnect && \(/, 'botão desconectar só renderiza com handler');
const types = fs.readFileSync(path.join(root, 'dashboard/lib/types.ts'), 'utf8');
assert.match(types, /interface AdsCapabilities/, 'tipo AdsCapabilities existe');
assert.match(types, /capabilities\?: AdsCapabilities/, 'AdsStatusResponse expõe capabilities');
console.log('ok: UI esconde identidade/desconectar via capabilities');

console.log('\ntodos os testes F6 passaram');
