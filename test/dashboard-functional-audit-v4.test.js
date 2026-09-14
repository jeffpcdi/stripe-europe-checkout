'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.js');
const adsRoutes = read('ads-routes.js');
const catalogStore = read('ads-catalog-store.js');
const confirmDialog = read('dashboard/components/confirm-dialog.tsx');
const conversions = read('dashboard/components/conversions/conversions-view.tsx');
const gatewayView = read('dashboard/components/gateways/gateways-view.tsx');
const queueHealth = read('dashboard/components/gateways/queue-health-panel.tsx');
const campaignTree = read('dashboard/components/ads/campaign-tree.tsx');
const tiktokView = read('dashboard/components/ads/tiktok-ads-view.tsx');
const catalogWizard = read('dashboard/components/ads/catalog-campaign-wizard.tsx');
const catalogDetail = read('dashboard/components/ads/catalog-detail.tsx');
const creativeLibrary = read('dashboard/components/ads/creative-library.tsx');
const catalogConnection = read('dashboard/components/ads/catalog-connection-card.tsx');

console.log('Auditoria funcional V4 — confirmações destrutivas');
assert.match(confirmDialog, /const submittingRef = useRef\(false\)/,
  'confirmação deve ter trava síncrona contra duplo clique');
assert.match(confirmDialog, /if \(!canConfirm \|\| submittingRef\.current\) return/,
  'trava deve ser consultada antes de executar a ação');
assert.match(confirmDialog, /await onConfirm\(\)/,
  'diálogo deve aguardar a operação assíncrona antes de liberar novo submit');
assert.match(conversions, /busy=\{deletingPixelBusy\}/,
  'remoção de pixel em Conversões deve bloquear submit repetido');
assert.match(conversions, /busy=\{deletingGatewayBusy\}/,
  'remoção de gateway em Conversões deve bloquear submit repetido');
assert.match(tiktokView, /if \(disconnecting\) return/,
  'desconexão TikTok deve bloquear clique repetido');
assert.doesNotMatch(tiktokView, /finally \{[\s\S]{0,100}setConfirmDisconnect\(false\)/,
  'falha ao desconectar não deve fechar a confirmação');
assert.match(catalogWizard, /async function action\(kind: 'resume' \| 'cleanup'\): Promise<boolean>/,
  'limpeza parcial deve expor sucesso/falha ao diálogo');
assert.doesNotMatch(catalogWizard, /finally \{[\s\S]{0,100}setConfirmCleanup\(false\)/,
  'falha de cleanup não deve fechar a confirmação');

console.log('Auditoria funcional V4 — backend destrutivo e atomicidade');
assert.match(server, /gateway_in_use_by_pixels/,
  'gateway explicitamente vinculado a pixel não pode ser excluído');
assert.match(server, /pixelStore\.list\(req\.account\.id\).*gatewayIds/s,
  'checagem de vínculo do gateway deve ser por conta');
assert.match(adsRoutes, /if \(err && err\.code === 'ENOENT'\) alreadyMissing = true;\s*else throw err;/,
  'biblioteca de criativos deve ignorar somente arquivo já ausente, não qualquer erro de I/O');
assert.match(catalogStore, /async function deleteCatalog[\s\S]*?await sql\.transaction\(statements\)/,
  'exclusão de catálogo deve ser transacional');
assert.match(catalogStore, /async function deleteProduct[\s\S]*?await sql\.transaction\(statements\)/,
  'produto e contador do catálogo devem ser atualizados atomicamente');

console.log('Auditoria funcional V4 — reparos e falsos sucessos');
assert.match(server, /app\.get\('\/api\/ops\/integrity'[\s\S]*?readAccountIntegrity/,
  'GET de integridade deve ser somente diagnóstico');
assert.match(server, /app\.post\('\/api\/ops\/integrity'[\s\S]*?repairAccountIntegrity/,
  'reparo de integridade deve usar POST');
assert.match(server, /falhas: repaired\.falhas/,
  'reparo deve reportar falhas parciais em vez de engoli-las');
assert.match(queueHealth, /apiSend<IntegrityResponse>\('\/api\/ops\/integrity', 'POST', \{\}\)/,
  'frontend deve usar POST para correção de integridade');
assert.match(queueHealth, /A correção foi apenas parcial/,
  'UI deve informar correção parcial');
assert.match(campaignTree, /result\.dryRun \|\| result\.simulated/,
  'delete de anúncio deve distinguir simulação de exclusão real');
assert.match(campaignTree, /Modo teste: o anúncio não foi excluído do TikTok/,
  'modo teste não pode apresentar exclusão simulada como real');
assert.match(catalogDetail, /Produto removido, mas a tela não atualizou completamente/,
  'falha de refresh posterior não deve ser confundida com falha da exclusão');
assert.match(creativeLibrary, /Criativo removido, mas a biblioteca não atualizou/,
  'falha de revalidação não deve transformar delete bem-sucedido em erro de exclusão');
assert.match(catalogConnection, /Vínculo salvo, mas a tela não atualizou completamente/,
  'refresh pós-vínculo deve ser separado do resultado da persistência');
assert.match(gatewayView, /const completed = await confirm\.run\(\)/,
  'confirmação customizada de gateway deve aguardar resultado real');

console.log('dashboard-functional-audit-v4: OK');
