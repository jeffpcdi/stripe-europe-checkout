'use strict'
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')

const list = read('dashboard/components/ads/catalog-list.tsx')
const detail = read('dashboard/components/ads/catalog-detail.tsx')
const editor = read('dashboard/components/ads/catalog-editor.tsx')
const connection = read('dashboard/components/ads/catalog-connection-card.tsx')
const readiness = read('dashboard/components/ads/catalog-readiness-card.tsx')
const productImport = read('dashboard/components/ads/catalog-product-import.tsx')
const quick = read('dashboard/components/ads/catalog-quick-campaigns-dialog.tsx')
const wizard = read('dashboard/components/ads/catalog-campaign-wizard.tsx')
const batch = read('dashboard/components/ads/catalog-batch-dialog.tsx')
const sync = read('dashboard/components/ads/catalog-sync-status.tsx')
const view = read('dashboard/components/ads/tiktok-ads-view.tsx')

// Lista operacional: sem KPI wall nem segundo launcher permanente.
assert.doesNotMatch(list, /Catálogo comercial/)
assert.doesNotMatch(list, /catalogSummary\.products/)
assert.doesNotMatch(list, /campaign-workspace/)
assert.match(list, /Catálogos/)
assert.match(view, /Criar pelo link/)
assert.doesNotMatch(list, />Novo catálogo</)

// Business Center e criação por link devem explicar o contrato real.
assert.match(list, /Business Center/)
assert.doesNotMatch(list, /TikTok conectado/)
assert.match(productImport, /quatro registros necessários para Catalog Ads/)
assert.match(productImport, /sem inventar preço, variante ou atributo/)
assert.match(list, /Clonar este catálogo\?/)
assert.match(list, /appearance="quiet"/)

// Readiness é primeira camada operacional, não diagnóstico escondido.
assert.match(readiness, /Próximo passo/)
assert.match(readiness, /readiness\.nextAction/)
assert.match(detail, /<CatalogReadinessCard/)
assert.match(detail, /Diagnóstico e detalhes técnicos/)
assert.match(detail, /Corrigir automaticamente/)
assert.doesNotMatch(detail, /Corrigir com IA/)

// Produto: progressive disclosure, dirty state e copy coerente com auto-sync.
assert.match(editor, /showOptional/)
assert.match(editor, /isDirty/)
assert.match(editor, /Alterações não salvas/)
assert.match(editor, /Descartar alterações\?/)
assert.match(editor, /appearance="quiet"/)
assert.match(editor, /disabled=\{busy \|\| missingRequired\.length > 0 \|\| !isDirty\}/)
assert.doesNotMatch(editor, /Produto salvo como rascunho/)
assert.doesNotMatch(editor, /Use Sincronizar/)
assert.match(detail, /Sincronização iniciada automaticamente/)
assert.match(detail, /sincronização da alteração será iniciada automaticamente/)

// Conexão segue o design atual e explica o efeito de alterar BC.
assert.doesNotMatch(connection, /input-neon/)
assert.match(connection, /atualiza o padrão usado pelos outros fluxos de catálogo/)
assert.match(connection, /appearance="quiet"/)

// Product Link reaproveita o compositor V16.2 e preflight antes da fila.
assert.match(quick, /tiktok-create-flow/)
assert.match(quick, /SavedVideos appearance="creation"/)
assert.match(quick, /MarketSelector appearance="creation"/)
assert.match(quick, /adsPreflightCatalogCampaign/)
assert.match(quick, /Revisar criação/)
assert.match(quick, /setPreflight\(null\)/)
assert.match(quick, /autoActivate: true/)
assert.match(quick, /Ativação automática/)
assert.match(quick, /Gasto diário potencial/)
assert.match(quick, /Criar e permitir ativação automática\?/)
assert.match(quick, /appearance="quiet"/)
assert.match(quick, /dryRun \? void create\(\) : setConfirmCreate\(true\)/)

// Wizard preserva estados reais; cleanup é quiet.
assert.match(wizard, /waiting_pixel_purchase/)
assert.match(wizard, /ready_paused/)
assert.match(wizard, /ready_active/)
assert.match(wizard, /appearance="quiet"/)

// Batch continua pausado e antecipa a dependência de sync.
assert.match(batch, /Preparar campanhas Product Link pausadas/)
assert.match(batch, /campanhas do lote usam todos os produtos do catálogo e sempre nascem pausadas/)
assert.match(batch, /disabled=\{!syncToTikTok/)
assert.match(batch, /dependem do catálogo sincronizado/)

// Sync mantém estados/retry, só muda apresentação.
assert.match(sync, /Retomar/)
assert.match(sync, /waiting_connector_confirmation|queued|active/)

console.log('[OK] TikTok Ads V16.5 — Catálogo operacional, autoexplicativo e sem novo backend.')
