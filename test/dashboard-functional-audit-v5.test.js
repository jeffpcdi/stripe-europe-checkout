'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.js');
const db = read('db.js');
const pixelStore = read('pixel-store.js');
const adsRoutes = read('ads-routes.js');
const adsOps = read('ads-ops-store.js');
const catalogStore = read('ads-catalog-store.js');
const gatewayStore = read('gateway-store.js');
const linkStore = read('link-store.js');
const linkEditor = read('dashboard/components/links/link-editor.tsx');
const conversionsView = read('dashboard/components/conversions/conversions-view.tsx');
const cloakEditor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
const catalogEditor = read('dashboard/components/ads/catalog-editor.tsx');
const catalogList = read('dashboard/components/ads/catalog-list.tsx');
const catalogDetail = read('dashboard/components/ads/catalog-detail.tsx');
const gatewaysView = read('dashboard/components/gateways/gateways-view.tsx');

console.log('Auditoria funcional V5 — criação e edição sem sobrescrita silenciosa');
assert.match(linkStore, /const createOnly = input\._createOnly === true/);
assert.match(linkStore, /if \(createOnly && targetExisting\)[\s\S]{0,300}err\.code = 'conflict'/);
assert.match(linkEditor, /const savingRef = useRef\(false\)/);
assert.match(linkEditor, /_createOnly: !link/);
assert.match(pixelStore, /pixel_create_conflict/);
assert.match(pixelStore, /pixel_revision_conflict/);
assert.match(db, /async function updatePixelVersioned[\s\S]*?COALESCE\(data->>'updatedAt', ''\)/);
assert.match(conversionsView, /_createOnly: !pixel/);
assert.match(conversionsView, /_baseUpdatedAt: pixel\?\.updatedAt/);
assert.match(conversionsView, /savingRef\.current/);

console.log('Auditoria funcional V5 — criação manual de campanha idempotente');
assert.match(adsOps, /async function reserveIdempotentOperation/);
assert.match(adsOps, /ON CONFLICT \(account_id, idempotency_key\) DO NOTHING/);
assert.match(adsOps, /kind NOT LIKE 'idempotency:%'/);
assert.match(adsRoutes, /reserveIdempotentOperation\(req\.account\.id/);
assert.match(read('dashboard/components/ads/universal-launcher-dialog.tsx'), /const submittingRef = useRef\(false\)/);
assert.match(adsRoutes, /CAMPAIGN_CREATE_IN_PROGRESS/);
assert.match(adsRoutes, /previous\.status === 'completed'[\s\S]{0,180}replayed: true/);
assert.match(adsRoutes, /setJobStatus\(req\.account\.id, idempotencyJobId, 'completed'/);
assert.match(adsRoutes, /hasCreatedIds \? 'partial' : 'failed'/);

console.log('Auditoria funcional V5 — Cloak retry-safe e concorrência');
assert.match(server, /cloak_revision_conflict/);
assert.match(server, /createHash\('sha256'\).*req\.account\.id \+ '\\|' \+ createKey/s);
assert.match(server, /replayed: true/);
assert.match(cloakEditor, /createRequestRef = useRef<\{ signature: string; key: string \} \| null>/);
assert.match(cloakEditor, /_baseUpdatedAt: entry\?\.updatedAt/);
assert.match(cloakEditor, /_createKey: entry \? undefined : createRequestRef\.current\?\.key/);

console.log('Auditoria funcional V5 — catálogo e produtos');
assert.match(catalogStore, /Edição explícita é por ID do produto/);
assert.match(catalogStore, /AND sku_id = \$\{skuId\} AND id <> \$\{productId\}/);
assert.match(catalogStore, /CATALOG_SKU_CONFLICT/);
assert.match(catalogStore, /async function bulkUpsertProducts[\s\S]*?sql\.transaction\(statements\)/);
assert.match(catalogEditor, /productId: persistedProductId, createOnly: !persistedProductId/);
assert.match(catalogEditor, /const busyRef = useRef\(false\)/);
assert.match(adsRoutes, /\{ data, productId: body\.productId, createOnly: body\.createOnly === true \}/);
assert.match(catalogList, /batchKey: manualCreateRef\.current\.key/);
assert.match(catalogStore, /clone:\$\{crypto\.createHash\('sha256'\).*catalogId.*requestKey/s);
assert.match(adsRoutes, /cloneRequest\.idempotencyKey/);
assert.match(catalogList, /cloneRequestKeysRef\.current\[catalogId\]/);
assert.match(catalogDetail, /cloneRequestKeyRef\.current \|\| crypto\.randomUUID\(\)/);

console.log('Auditoria funcional V5 — edição de gateways');
assert.match(gatewayStore, /const providerChanged = !!\(existing && existing\.provider !== provider\)/);
assert.match(gatewayStore, /providerChanged \? null : \(existing \? existing\.secret : null\)/);
assert.match(gatewayStore, /providerChanged \? \{\} : \(existing \? existing\.config : \{\}\)/);
assert.match(gatewaysView, /Ao trocar o provedor, o segredo antigo não será reaproveitado/);
assert.match(gatewaysView, /gateway \? 'Salvar gateway' : 'Criar gateway'/);
assert.match(gatewaysView, /const savingRef = useRef\(false\)/);

console.log('dashboard-functional-audit-v5: OK');
