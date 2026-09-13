'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const domain = require('../catalog/catalog-domain');
const gateway = require('../catalog/catalog-tiktok-gateway');
const adsProvider = require('../ads-provider');

let n = 0;
function ok(value, label) { assert.ok(value, label); n += 1; console.log('  ✓ ' + label); }
function eq(actual, expected, label) { assert.deepStrictEqual(actual, expected, label); n += 1; console.log('  ✓ ' + label); }
function throwsCode(fn, code, label) {
  try { fn(); ok(false, label + ' (deveria lançar)'); }
  catch (error) { eq(error.code, code, label); }
}

(async () => {
  console.log('Domínio — prontidão baseada em estados reais');
  const products = Array.from({ length: 4 }, (_, index) => ({
    valid: true, data: { sku_id: 'sku_' + index, brand: 'Marca real' },
    updatedAt: '2026-07-20T10:00:00.000Z',
  }));
  const base = {
    tiktokCatalogId: '7662123486130784016', bcId: '7550683248272228369',
    linkStatus: 'verified', linkError: null, syncedAt: '2026-07-20T11:00:00.000Z',
    updatedAt: '2026-07-20T11:00:00.000Z', audit: { approved: 4, pending: 0, rejected: 0 },
  };
  let readiness = domain.computeReadiness({}, [], {});
  eq(readiness.nextAction, 'add_products', 'catálogo vazio pede o primeiro produto');
  readiness = domain.computeReadiness({ ...base, tiktokCatalogId: null, bcId: null, linkStatus: 'unlinked', audit: null, syncedAt: null }, products, {});
  eq(readiness.nextAction, 'connect_tiktok', 'produto válido sem vínculo pede conexão');
  readiness = domain.computeReadiness(base, products, { advertiserId: '1870000000001' });
  ok(readiness.readyForCampaign, 'quatro aprovados, vínculo e advertiser liberam campanha');
  const belowMinimum = domain.computeReadiness(
    { ...base, audit: { approved: 3, pending: 0, rejected: 0 } },
    products,
    { advertiserId: '1870000000001' },
  );
  ok(!belowMinimum.readyForCampaign, 'três aprovados ainda não liberam Catalog Ads');
  eq(belowMinimum.counts.approvedMissing, 1, 'prontidão informa quantos aprovados faltam');
  const reviewDetail = belowMinimum.steps.find((item) => item.id === 'review').detail;
  ok(/mínimo de 4/.test(reviewDetail), 'mensagem pt-BR explica o piso de aprovação');
  ok(!/ativos e em estoque/.test(reviewDetail), 'overview agregado não promete disponibilidade por SKU sem prova');
  readiness = domain.computeReadiness(base, products.map((product, index) => (
    index === 0 ? { ...product, updatedAt: '2026-07-20T12:00:00.000Z' } : product
  )), { advertiserId: '1870000000001' });
  eq(readiness.nextAction, 'create_campaign', 'catálogo remoto aprovado continua disponível apesar de edição local');
  ok(readiness.readyForCampaign, 'alteração local não bloqueia campanha ALL com produtos remotos aprovados');
  ok(readiness.hasUnpublishedChanges, 'diferença local continua explícita para uma sincronização futura');

  const elevenLocalProducts = Array.from({ length: 11 }, (_, index) => ({
    valid: true, data: { sku_id: 'local_' + index, brand: 'Marca real' },
    updatedAt: '2026-07-20T12:00:00.000Z',
  }));
  readiness = domain.computeReadiness(
    { ...base, audit: { approved: 10, pending: 0, rejected: 0, total: 10 } },
    elevenLocalProducts,
    { advertiserId: '1870000000001' },
  );
  ok(readiness.readyForCampaign, 'dez produtos confirmados no TikTok liberam a campanha');
  eq(readiness.counts.remoteTotal, 10, 'contagem principal preserva a verdade do TikTok');
  eq(readiness.counts.localOnly, 1, 'diferença local é informada sem fingir que existe no TikTok');
  ok(/10 produtos no TikTok/.test(readiness.steps.find((item) => item.id === 'products').detail), 'checklist mostra a contagem remota');

  readiness = domain.computeReadiness(
    { ...base, audit: { approved: 10, pending: 0, rejected: 0, total: 10 } },
    [],
    { advertiserId: '1870000000001' },
  );
  ok(readiness.readyForCampaign, 'catálogo remoto vinculado não depende de cópias locais para escopo ALL');

  console.log('Domínio — contrato explícito da campanha');
  const coverError = new Error('URL técnica inválida');
  coverError.step = 'cover';
  const serializedCover = domain.serializeCatalogError(coverError);
  eq(serializedCover.userMessage, 'O vídeo foi enviado, mas a capa automática ainda não ficou pronta.', 'erro de capa explica o estado real sem mensagem genérica');
  ok(/mesmo vídeo/.test(serializedCover.suggestedAction), 'erro de capa orienta a não reenviar o arquivo');
  const input = {
    name: 'Catálogo manual', budgetAmount: 50, productScope: 'specific',
    productIds: ['SKU-local'], pixelId: '7550683248272228369',
    videoUrl: 'https://cdn.test/catalogo.mp4',
  };
  const spec = domain.normalizeCampaignSpec(input, { name: 'Loja', country: 'BR' });
  const market = domain.normalizeCampaignSpec({ ...input, countries: ['us', 'CA', 'us'], languages: ['EN'] }, {});
  eq(market.countries.join(','), 'US,CA', 'países atravessam a normalização sem duplicatas');
  eq(market.languages.join(','), 'en', 'idioma chega ao worker');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, countries: [] }, {}), 'CATALOG_COUNTRIES_INVALID', 'país vazio não vira Brasil silenciosamente');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, languages: ['invalid'] }, {}), 'CATALOG_LANGUAGES_INVALID', 'idioma inválido é bloqueado');
  eq(spec.destination, 'PRODUCT_LINK', 'destino vem do produto, sem URL manual');
  eq(spec.creativeMode, 'SINGLE_VIDEO', 'spec usa vídeo de catálogo com áudio embutido');
  eq(spec.strategy, 'catalog_video_product_link', 'estratégia Product Link fica explícita');
  eq(spec.budgetOptimization, 'adgroup', 'ABO é o padrão');
  eq(spec.bidStrategy, 'lowest_cost', 'máxima entrega é o padrão');
  eq(spec.deliveryMode, 'standard', 'entrega padrão é o ritmo inicial');
  eq(spec.pixelEvent, 'ON_WEB_ORDER', 'evento de compra canônico é o padrão');
  const accelerated = domain.normalizeCampaignSpec({ ...input, bidStrategy: 'cost_cap', bidAmount: 12.5, deliveryMode: 'accelerated' }, {});
  eq(accelerated.bidAmount, 12.5, 'Cost Cap preserva o CPA alvo');
  eq(accelerated.deliveryMode, 'accelerated', 'ABO + Cost Cap aceita entrega acelerada');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, bidStrategy: 'cost_cap' }, {}), 'CATALOG_CAMPAIGN_BID_AMOUNT_REQUIRED', 'Cost Cap sem CPA é bloqueado antes da fila');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, deliveryMode: 'accelerated' }, {}), 'CATALOG_CAMPAIGN_ACCELERATED_REQUIRES_COST_CAP', 'máxima entrega não aceita aceleração');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, budgetOptimization: 'campaign', bidStrategy: 'cost_cap', bidAmount: 10, deliveryMode: 'accelerated' }, {}), 'CATALOG_CAMPAIGN_ACCELERATED_REQUIRES_ABO', 'CBO não aceita aceleração');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, deliveryMode: 'turbo' }, {}), 'CATALOG_CAMPAIGN_DELIVERY_MODE_INVALID', 'modo de entrega desconhecido não chega ao provider');
  const chosenProfile = domain.normalizeCampaignSpec({
    ...input,
    identityId: 'e13cdf03-d5e5-56d0-a26a-8149f22efea7',
    identityType: 'BC_AUTH_TT',
    identityBcId: '7550683248272228369',
  }, {});
  eq(chosenProfile.identityType, 'BC_AUTH_TT', 'perfil autorizado é persistido no run');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, identityId: 'perfil', identityType: 'BC_AUTH_TT' }, {}), 'CATALOG_IDENTITY_INCOMPLETE', 'perfil sem BC não entra na fila');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, identityId: 'perfil', identityType: 'TT_USER', identityBcId: '7550683248272228369' }, {}), 'CATALOG_IDENTITY_TYPE_INVALID', 'identidade Spark não entra em catálogo com upload novo');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, budgetAmount: 49.99 }, {}), 'CATALOG_CAMPAIGN_BUDGET_BELOW_MINIMUM', 'bloqueia orçamento abaixo do piso do TikTok');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, productIds: ['SKU,quebrado'] }, {}), 'CATALOG_ITEM_GROUP_ID_INVALID', 'item_group_id inválido não chega ao provider');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, pixelId: '' }, {}), 'CATALOG_PIXEL_REQUIRED', 'pixel é obrigatório para CONVERT');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, pixelId: 'pixel-local' }, {}), 'CATALOG_PIXEL_ID_INVALID', 'Pixel ID precisa ser numérico');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, pixelEvent: 'EVENTO_INVENTADO' }, {}), 'CATALOG_PIXEL_EVENT_INVALID', 'evento desconhecido não chega ao provider');
  eq(domain.normalizeCampaignSpec({ ...input, pixelEvent: 'PURCHASE' }, {}).pixelEvent, 'ON_WEB_ORDER', 'alias legado PURCHASE é normalizado sem adivinhação');
  eq(domain.normalizeCampaignSpec({ ...input, pixelEvent: 'SHOPPING' }, {}).pixelEvent, 'SHOPPING', 'aceita o enum de Compra realmente exposto pelo Pixel');
  throwsCode(() => domain.normalizeCampaignSpec({ ...input, videoUrl: '' }, {}), 'CATALOG_VIDEO_REQUIRED', 'vídeo é obrigatório e não depende do Ads Manager');

  console.log('Gateway — vínculo verificado contra o Business Center');
  const remote = await gateway.verifyCatalogLink({
    async listTikTokCatalogs() {
      return [{ catalog_id: '7662123486130784016', catalog_name: 'E-commerce catalog', currency: 'BRL', region: 'BR', product_count: 2 }];
    },
  }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
  eq(remote.name, 'E-commerce catalog', 'normaliza o snapshot remoto');
  eq(remote.productCount, 2, 'preserva contagem remota');
  try {
    await gateway.verifyCatalogLink({ async listTikTokCatalogs() { return []; } }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
    ok(false, 'catálogo ausente deveria falhar');
  } catch (error) {
    eq(error.code, 'CATALOG_NOT_FOUND_IN_BC', 'ID copiado não vira vínculo sem confirmação remota');
    eq(error.retryable, false, 'erro de ID/BC não é retry cego');
    // BC devolveu ZERO catálogos → aponta para acesso do token/BC errado.
    ok(/nenhum catálogo/i.test(error.userMessage), 'zero visíveis: mensagem fala em BC sem catálogos/acesso do token');
    ok(error.userMessage.includes('7550683248272228369'), 'mensagem nomeia o BC consultado');
  }
  try {
    // BC com catálogos, mas nenhum com o ID pedido → o Catalog ID é que está errado.
    await gateway.verifyCatalogLink({
      async listTikTokCatalogs() { return [{ catalog_id: '9999999999999999999', catalog_name: 'outro' }]; },
    }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
    ok(false, 'ID inexistente no BC deveria falhar');
  } catch (error) {
    eq(error.code, 'CATALOG_NOT_FOUND_IN_BC', 'ID que não está no BC não vira vínculo');
    ok(error.userMessage.includes('7662123486130784016'), 'mensagem nomeia o Catalog ID pedido');
    ok(/1 catálogo/.test(error.userMessage), 'mensagem informa quantos catálogos o BC tinha');
  }

  const overviewFallback = await gateway.verifyCatalogLink({
    async listTikTokCatalogs() { return []; },
    async getTikTokCatalogOverview() {
      return { total: 3, raw: { catalog_id: '7662123486130784016' } };
    },
  }, { bcId: '7550683248272228369', catalogId: '7662123486130784016' });
  eq(overviewFallback.id, '7662123486130784016', 'overview com catalog_id confirma vínculo quando a listagem está vazia');
  eq(overviewFallback.productCount, 3, 'fallback preserva total do overview');

  const overview = adsProvider._internals.normalizeCatalogOverview({
    approved_products: 2, pending_products: 3, disapproved_products: 4, total_products: 9,
  });
  eq(overview.approved, 2, 'normaliza approved_products do conector vivo');
  eq(overview.pending, 3, 'normaliza pending_products do conector vivo');
  eq(overview.rejected, 4, 'normaliza disapproved_products do conector vivo');
  eq(overview.total, 9, 'normaliza total_products do conector vivo');

  const blockedCapabilities = await gateway.capabilities({
    async getCatalogCapabilities() {
      return { catalogCreate: false, manualCatalogCampaign: false, catalogUpload: true };
    },
  });
  eq(blockedCapabilities.manualCatalogCampaign, false, 'capability real bloqueia campanha parcial');
  eq(blockedCapabilities.catalogCreate, false, 'capability real não promete criação sem catalog_conf');

  console.log('Persistência e UI — jobs retomáveis e componentes separados');
  const store = fs.readFileSync(path.join(__dirname, '..', 'ads-catalog-store.js'), 'utf8');
  ok(/CREATE TABLE IF NOT EXISTS ads_catalog_sync_runs/.test(store), 'schema contém jobs de sincronização');
  ok(/CREATE TABLE IF NOT EXISTS ads_catalog_campaign_runs/.test(store), 'schema contém jobs da hierarquia de campanha');
  ok(/asset_attempts integer NOT NULL DEFAULT 0/.test(store), 'retry de vídeo/capa tem contador durável próprio');
  ok(/activation_attempts integer NOT NULL DEFAULT 0/.test(store), 'ativação segura tem contador durável próprio');
  ok(/status = 'waiting_pixel_purchase'/.test(store), 'pedido aguarda o Pixel sem desaparecer nem falhar');
  ok(/FOR UPDATE SKIP LOCKED/.test(store), 'workers reivindicam jobs sem corrida');
  ok(/status = 'retrying'[\s\S]+next_retry_at <= now\(\)/.test(store), 'backoff de asset é respeitado antes de reivindicar o job');
  ok(/END >= \$\{TIKTOK_MIN_APPROVED_PRODUCTS\}/.test(store), 'promoção da fila só ocorre com quatro produtos aprovados');
  ok(/resumeSyncRun/.test(store) && /resumeCampaignRun/.test(store), 'falhas podem ser retomadas');
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(/campaign-preflight/.test(routes), 'preflight existe antes da escrita');
  ok(/pipeboard\.resolveCatalogPurchaseEvent/.test(routes) && !/provider\.resolveCatalogPurchaseEvent/.test(routes), 'preflight usa a fronteira Pipeboard para descobrir o evento de Compra real');
  ok(/connectorReady: capabilities\.catalogSingleVideoCampaign === true/.test(routes), 'preflight salva a configuração e deixa o worker aguardar o conector sem criar parcial');
  ok(/catalog-sync-runs\/:runId\/resume/.test(routes), 'sincronização falha tem endpoint de retomada');
  ok(/CATALOG_CAMPAIGN_NOT_CLEANABLE/.test(routes), 'cleanup não remove campanha concluída');
  const manager = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-manager.tsx'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-detail.tsx'), 'utf8');
  const catalogUi = manager + '\n' + detail;
  const connectionCard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-connection-card.tsx'), 'utf8');
  const syncStatus = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-sync-status.tsx'), 'utf8');
  const wizard = fs.readFileSync(path.join(__dirname, '..', 'dashboard', 'components', 'ads', 'catalog-campaign-wizard.tsx'), 'utf8');
  ok(/mutateRuns\(\)/.test(wizard), 'novo run força leitura imediata do progresso na UI');
  ok(/CatalogReadinessCard/.test(catalogUi), 'UI usa checklist de prontidão');
  ok(/CatalogConnectionCard/.test(catalogUi), 'UI separa conexão remota');
  ok(/CatalogCampaignWizard/.test(catalogUi), 'UI usa assistente da campanha completa');
  ok(/catalogSingleVideoCampaign === true/.test(catalogUi) && /const connectorReady = capabilities\?\.catalogSingleVideoCampaign === true/.test(wizard), 'UI condiciona criação ao schema atual do Pipeboard');
  ok(/cover: 'Preparando capa do vídeo'/.test(wizard), 'UI mostra a etapa automática da capa');
  ok(/Vídeo preparado/.test(wizard) && /run\.createdIds\.videoId/.test(wizard), 'UI distingue vídeo preservado de campanha parcial');
  ok(/run\.error\.code/.test(wizard) && /run\.error\.message/.test(wizard) && /providerRequestId/.test(wizard), 'detalhes técnicos preservam a causa real para diagnóstico');
  ok(/catalog\.linkStatus === 'verified'/.test(catalogUi) && /Vínculo com erro/.test(catalogUi), 'UI não anuncia vínculo quebrado como catálogo publicado');
  ok(/Revisão concluída com reprovações/.test(catalogUi) && /pending > 0/.test(catalogUi), 'UI não chama produtos reprovados de produtos em análise');
  ok(/label: 'Sem produtos'/.test(catalogUi) && /label: 'Vinculado'/.test(catalogUi), 'lista separa vínculo remoto de catálogo pronto');
  ok(/catalog\.audit\?\.total/.test(connectionCard) && /último status/.test(connectionCard), 'contagem remota usa a auditoria atual em vez do snapshot antigo do vínculo');
  ok(/remoteReadyWithDifference/.test(syncStatus) && /LABELS\[run\.status\]/.test(syncStatus), 'status distingue catálogo remoto pronto de processamento ou falha');
  ok(/item_group_id: skuId/.test(catalogUi), 'duplicar produto cria agrupador próprio em vez de reutilizar o SKU original');
  ok(/ConfirmDialog/.test(catalogUi) && !/\bconfirm\(/.test(catalogUi), 'exclusões usam confirmação acessível e não confirm nativo');
  ok(/envio aceito/.test(catalogUi), 'histórico distingue envio aceito de aprovação do TikTok');
  ok(/DELETE FROM ads_catalog_campaign_runs/.test(store) && /DELETE FROM ads_catalog_publications/.test(store), 'exclusão remove jobs e publicações órfãos');
  ok(!/autoPublish=\{bcConfigured\}/.test(catalogUi), 'salvar produto não publica silenciosamente');

  console.log('\nads-catalog-v2: ' + n + ' asserts OK');
})().catch((error) => { console.error(error); process.exit(1); });
