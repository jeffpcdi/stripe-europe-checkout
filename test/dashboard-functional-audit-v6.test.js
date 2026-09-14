'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const config = read('config.js');
const db = read('db.js');
const server = read('server.js');
const adsRoutes = read('ads-routes.js');
const webPush = read('web-push-notify.js');
const types = read('dashboard/lib/types.ts');
const domains = read('dashboard/components/domains/domains-view.tsx');
const configView = read('dashboard/components/config/config-view.tsx');
const accountSecurity = read('dashboard/components/config/account-security.tsx');
const cloakConfig = read('dashboard/components/cloak/cloak-config-panel.tsx');

console.log('Auditoria funcional V6 — persistência antes do cache');
assert.match(config, /function cloneConfig\(value\)[\s\S]{0,180}JSON\.parse\(JSON\.stringify\(value\)\)/,
  'config.get deve devolver clone profundo e impedir mutação aninhada do cache');
assert.match(config, /async function setDurableNow[\s\S]*?await db\.saveConfig\(prepared\.key, prepared\.next\)[\s\S]*?cache\.set\(prepared\.key, prepared\.next\)/,
  'caminho durável deve confirmar Neon antes de publicar no cache');
assert.match(config, /await persistDiskEntryNow\(prepared\.key, prepared\.next\)[\s\S]*?cache\.set\(prepared\.key, prepared\.next\)/,
  'fallback sem Neon deve confirmar snapshot local antes do cache');
assert.match(config, /const durableQueues = new Map\(\)/,
  'mutações duráveis devem ser serializadas por conta');
assert.match(config, /typeof patch === 'function' \? patch\(cloneConfig\(current\)\) : patch/,
  'setDurable deve aceitar read-modify-write calculado sobre a versão mais recente');
assert.match(config, /CONFIG_REVISION_CONFLICT/,
  'config durável deve suportar revisão otimista entre abas');
assert.match(db, /async function saveConfig[\s\S]*?return true;[\s\S]*?return false;/,
  'db.saveConfig deve propagar sucesso/falha real ao chamador');

console.log('Auditoria funcional V6 — rotas de configuração');
assert.match(server, /savedCfg = await config\.setDurable\(req\.account\.id, \{ settings: s \}/,
  'preferências da conta devem usar persistência forte');
assert.match(server, /expectedUpdatedAt: body\._baseUpdatedAt \|\| null/,
  'preferências devem rejeitar edição de uma versão antiga');
assert.match(server, /configUpdatedAt: accountConfig\.updatedAt \|\| null/,
  'domínios devem expor revisão da config ao frontend');
assert.match(server, /await config\.setDurable\(req\.account\.id, \(latest\) => \{[\s\S]{0,500}currentDomains/,
  'cadastro de domínio deve fazer read-modify-write dentro da fila durável');
assert.match(server, /await config\.setDurable\(req\.account\.id, \(latest\) => \(\{[\s\S]{0,180}customDomains:/,
  'remoção de domínio deve confirmar fonte durável antes do cache/provider');
assert.match(server, /saved = await config\.setDurable\(req\.account\.id, \{ cloak: next \}/,
  'configuração global do Cloak deve ser durável');
assert.match(server, /savedCfg = await config\.setDurable\(req\.account\.id, \{ cloakLinks: nextList \}/,
  'edições de links Cloak não podem responder sucesso antes da persistência');
assert.doesNotMatch(server, /config\.set\(req\.account\.id/,
  'rotas autenticadas de mutação não devem usar o write-through legado');
assert.match(adsRoutes, /await config\.setDurable\(req\.account\.id, \{ profitability:/,
  'configuração de lucratividade em Ads deve ser durável');
assert.match(adsRoutes, /await config\.setDurable\(req\.account\.id, \(latest\) =>/,
  'preferências de vídeo/integrações Ads devem mesclar sobre a versão atual');

console.log('Auditoria funcional V6 — frontend e notificações');
assert.match(types, /export interface AccountSettings[\s\S]*?updatedAt\?: string \| null/,
  'contrato de settings deve carregar revisão');
assert.match(types, /export interface DomainsResponse[\s\S]*?configUpdatedAt\?: string \| null/,
  'contrato de domínios deve carregar revisão');
assert.match(types, /export interface CloakConfig[\s\S]*?configUpdatedAt\?: string \| null/,
  'contrato do Cloak global deve carregar revisão');
assert.match(domains, /_baseUpdatedAt: data\?\.configUpdatedAt \|\| undefined/,
  'cadastro de domínio deve enviar a versão que o usuário viu');
assert.match(configView, /_baseUpdatedAt: data\?\.updatedAt \|\| undefined/,
  'resumo diário deve enviar revisão da configuração');
assert.match(accountSecurity, /_baseUpdatedAt: data\?\.updatedAt \|\| undefined/,
  'preferências avançadas devem enviar revisão da configuração');
assert.match(cloakConfig, /_baseUpdatedAt: data\?\.configUpdatedAt \|\| undefined/,
  'Cloak global deve enviar revisão da configuração');
assert.match(webPush, /await config\.setDurable\(accountId, \(latest\) =>/,
  'remoção automática de inscrição Web Push morta deve ser persistida antes de desaparecer do cache');
assert.match(webPush, /const persisted = await db\.saveConfig\('_webpush', vapid\)/,
  'VAPID não deve declarar persistência sem confirmação do banco');

console.log('dashboard-functional-audit-v6: OK');
