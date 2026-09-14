'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.js');
const adsRoutes = read('ads-routes.js');
const adsOps = read('ads-ops-store.js');
const catalogStore = read('ads-catalog-store.js');
const gatewayStore = read('gateway-store.js');
const linkStore = read('link-store.js');
const linkEditor = read('dashboard/components/links/link-editor.tsx');
const pixelsView = read('dashboard/components/pixels/pixels-view.tsx');
const cloakEditor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
const catalogEditor = read('dashboard/components/ads/catalog-editor.tsx');
const catalogList = read('dashboard/components/ads/catalog-list.tsx');
const catalogDetail = read('dashboard/components/ads/catalog-detail.tsx');
const gatewaysView = read('dashboard/components/gateways/gateways-view.tsx');

console.log('Auditoria funcional V5 — criação e edição sem sobrescrita silenciosa');
assert.match(linkStore, /const createOnly = input\._createOnly === true/,
  'store de Links deve distinguir criação de edição');
assert.match(linkStore, /if \(createOnly && existing\)[\s\S]{0,300}err\.code = 'conflict'/,
  'criação de Link não pode sobrescrever slug existente');
assert.match(linkEditor, /const savingRef = useRef\(false\)/,
  'editor de Links deve bloquear submit síncrono repetido');
assert.match(linkEditor, /_createOnly: !link/,
  'editor de Links deve declarar criação explicitamente');

assert.match(server, /pixel_create_conflict/,
  'criação de Pixel deve rejeitar colisão de slug em vez de editar registro existente');
assert.match(server, /pixel_revision_conflict/,
  'edição de Pixel deve detectar versão antiga aberta em outra aba');
assert.match(pixelsView, /_createOnly: clone \|\| !pixel/,
  'novo Pixel e clone devem usar semântica create-only');
assert.match(pixelsView, /_baseUpdatedAt: !clone \? pixel\?\.updatedAt : undefined/,
  'edição de Pixel deve enviar versão base para concorrência otimista');
assert.match(pixelsView, /savingRef\.current/,
  'editor de Pixel deve impedir duplo submit antes do rerender');

console.log('Auditoria funcional V5 — criação manual de campanha idempotente');
assert.match(adsOps, /async function reserveIdempotentOperation/,
  'backend deve reservar atomicamente a chave antes de operação síncrona externa');
assert.match(adsOps, /ON CONFLICT \(account_id, idempotency_key\) DO NOTHING/,
  'reserva precisa ser atômica entre requests concorrentes');
assert.match(adsOps, /kind NOT LIKE 'idempotency:%'/,
  'ledger interno não deve poluir a lista operacional existente');
assert.match(adsRoutes, /reserveIdempotentOperation\(req\.account\.id/,
  'criação manual deve consumir a chave que o launcher já envia');
assert.match(read('dashboard/components/ads/universal-launcher-dialog.tsx'), /const submittingRef = useRef\(false\)/,
  'launcher deve bloquear duplo clique antes do rerender');
assert.match(adsRoutes, /CAMPAIGN_CREATE_IN_PROGRESS/,
  'retry concorrente deve ser bloqueado antes de criar outra campanha');
assert.match(adsRoutes, /previous\.status === 'completed'[\s\S]{0,180}replayed: true/,
  'retry após resposta perdida deve devolver o resultado já persistido');
assert.match(adsRoutes, /setJobStatus\(req\.account\.id, idempotencyJobId, 'completed'/,
  'resultado real da criação deve finalizar o ledger idempotente');
assert.match(adsRoutes, /hasCreatedIds \? 'partial' : 'failed'/,
  'falha parcial com IDs criados deve ficar marcada sem permitir duplicação por retry');

console.log('Auditoria funcional V5 — Cloak retry-safe e concorrência');
assert.match(server, /cloak_revision_conflict/,
  'edição de Cloak deve rejeitar sobrescrita de versão mais nova');
assert.match(server, /createHash\('sha256'\).*req\.account\.id \+ '\\|' \+ createKey/s,
  'criação de Cloak deve derivar id estável por conta e tentativa');
assert.match(server, /replayed: true/,
  'retry de criação Cloak deve devolver entidade já criada');
assert.match(cloakEditor, /createRequestRef = useRef<\{ signature: string; key: string \} \| null>/,
  'frontend Cloak deve manter chave de criação por formulário');
assert.match(cloakEditor, /_baseUpdatedAt: entry\?\.updatedAt/,
  'frontend Cloak deve enviar revisão da edição');
assert.match(cloakEditor, /_createKey: entry \? undefined : createRequestRef\.current\?\.key/,
  'frontend Cloak deve reutilizar chave em retry de criação');

console.log('Auditoria funcional V5 — catálogo e produtos');
assert.match(catalogStore, /Edição explícita é por ID do produto/,
  'edição de produto deve preservar identidade da linha');
assert.match(catalogStore, /AND sku_id = \$\{skuId\} AND id <> \$\{productId\}/,
  'troca de SKU deve validar conflito com outro produto');
assert.match(catalogStore, /CATALOG_SKU_CONFLICT/,
  'novo produto com SKU existente deve retornar conflito explícito');
assert.match(catalogStore, /async function bulkUpsertProducts[\s\S]*?sql\.transaction\(statements\)/,
  'importação de produtos deve ser transacional em produção');
assert.match(catalogEditor, /productId: persistedProductId, createOnly: !persistedProductId/,
  'editor deve informar se salva produto existente ou cria um novo');
assert.match(catalogEditor, /const busyRef = useRef\(false\)/,
  'editor de produto deve bloquear clique duplo síncrono');
assert.match(adsRoutes, /\{ data, productId: body\.productId, createOnly: body\.createOnly === true \}/,
  'rota de produto deve encaminhar controles de edição/create-only sem persistir esses campos');

assert.match(catalogList, /batchKey: manualCreateRef\.current\.key/,
  'criação manual de catálogo deve reutilizar batchKey em retry');
assert.match(catalogStore, /clone:\$\{crypto\.createHash\('sha256'\).*catalogId.*requestKey/s,
  'clone de catálogo deve usar chave idempotente vinculada à origem');
assert.match(adsRoutes, /cloneRequest\.idempotencyKey/,
  'rota de clone deve encaminhar a chave de idempotência');
assert.match(catalogList, /cloneRequestKeysRef\.current\[catalogId\]/,
  'clone na listagem deve preservar chave até confirmação');
assert.match(catalogDetail, /cloneRequestKeyRef\.current \|\| crypto\.randomUUID\(\)/,
  'clone no detalhe deve reutilizar chave após timeout/erro desconhecido');

console.log('Auditoria funcional V5 — edição de gateways');
assert.match(gatewayStore, /const providerChanged = !!\(existing && existing\.provider !== provider\)/,
  'store deve detectar troca de provedor');
assert.match(gatewayStore, /providerChanged \? null : \(existing \? existing\.secret : null\)/,
  'segredo de um provedor não pode ser reaproveitado em outro');
assert.match(gatewayStore, /providerChanged \? \{\} : \(existing \? existing\.config : \{\}\)/,
  'config específica deve recomeçar ao trocar de provedor');
assert.match(gatewaysView, /Ao trocar o provedor, o segredo antigo não será reaproveitado/,
  'frontend deve explicar a consequência da troca de provedor');
assert.match(gatewaysView, /gateway \? 'Salvar gateway' : 'Criar gateway'/,
  'CTA deve distinguir edição de criação');
assert.match(gatewaysView, /const savingRef = useRef\(false\)/,
  'editor de gateway deve bloquear duplo submit síncrono');

console.log('dashboard-functional-audit-v5: OK');
