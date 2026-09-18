'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const accountSecurity = read('dashboard/components/config/account-security.tsx');
const links = read('dashboard/components/links/links-view.tsx');
const webPush = read('dashboard/lib/web-push.ts');
const webPushCard = read('dashboard/components/config/web-push-card.tsx');
const creativeLibrary = read('dashboard/components/ads/creative-library.tsx');
const catalogEditor = read('dashboard/components/ads/catalog-editor.tsx');
const catalogDetail = read('dashboard/components/ads/catalog-detail.tsx');
const magicOps = read('dashboard/components/ads/magic-ops-panel.tsx');
const server = read('server.js');
const adsRoutes = read('ads-routes.js');
const legacyDashboard = read('dashboard-view.js');

console.log('Auditoria funcional — camada de requests');
assert.match(accountSecurity, /apiSend\(`\/api\/account\/sessions\/\$\{encodeURIComponent\(sid\)\}`, 'DELETE'\)/,
  'encerrar sessão usa contrato comum e valida HTTP');
assert.doesNotMatch(accountSecurity, /await fetch\(`\/api\/account\/sessions\//,
  'encerrar sessão não ignora mais status HTTP');
assert.match(webPush, /if \(!res\.ok \|\| !json\.ok\)/,
  'unsubscribe valida resposta do servidor');
assert.ok(webPush.indexOf('if (!res.ok || !json.ok)') < webPush.indexOf('await subscription.unsubscribe()'),
  'inscrição local só é removida depois da confirmação do servidor');
assert.match(webPushCard, /Não foi possível salvar a preferência/,
  'falha ao salvar preferência de push fica visível');
assert.match(creativeLibrary, /apiSend\(`\/api\/ads\/library\?url=/,
  'biblioteca usa request autenticada padronizada');
assert.match(catalogEditor, /adsUpload\(file, 'image'\)/,
  'upload de imagem de catálogo usa retry/validação comum');
assert.match(catalogDetail, /fetcher\(adsCatalogApiUrl\(`\/api\/ads\/catalogs\/\$\{encodeURIComponent\(catalogId\)\}\/audit`/,
  'auditoria de catálogo usa fetcher comum');
assert.match(magicOps, /import \{ apiSend, fetcher \} from '@\/lib\/api'/,
  'ferramentas avançadas usam o mesmo tratamento de sessão/erro');

console.log('Auditoria funcional — ações e rollback');
assert.match(links, /const previous = data[\s\S]*await mutate\(optimistic, \{ revalidate: false \}\)[\s\S]*if \(previous\) await mutate\(previous, \{ revalidate: false \}\)/,
  'toggle de link tem rollback explícito');
assert.match(links, /A ação em massa foi interrompida/,
  'falha parcial em ação em massa é informada');
assert.match(links, /setSelected\(new Set\(slugs\.slice\(completed\)\)\)/,
  'itens já concluídos não ficam selecionados para repetir a ação');

console.log('Auditoria funcional — isolamento multi-tenant');
assert.match(server, /function resolveCheckoutLink\(req\)[\s\S]*?const domainOwner = publicDomainOwner\(req\);[\s\S]*?if \(!domainOwner\) return linkStore\.resolve[\s\S]*?linkStore\.get\(domainOwner, req\.params\.slug\)/,
  '/go e URL limpa em domínio personalizado não caem em link de outra conta');
assert.match(server, /if \(domainOwner\) \{[\s\S]*if \(!r\) return null;[\s\S]*return r;[\s\S]*\}/,
  '/c em domínio personalizado fica preso à conta dona do host');
assert.match(server, /const indexedOwner = config\.accountForCloakSlug\(slug\);/,
  '/c no host compartilhado resolve slug por índice global sem varrer tenants');

console.log('Auditoria funcional — textos operacionais');
for (const [name, source] of [['server.js', server], ['ads-routes.js', adsRoutes]]) {
  assert.doesNotMatch(source, /an��ncios|autom��tico|inválida �� use|n��o encontrado|v��lido|p��gina/,
    `${name} não expõe texto corrompido nas respostas`);
}
assert.doesNotMatch(legacyDashboard, /��ltimos 7 dias|leadId\|\|'��'/,
  'dashboard legado não exibe caracteres corrompidos nos controles principais');

console.log('dashboard-functional-audit: requests, rollback, isolamento e mensagens OK');
