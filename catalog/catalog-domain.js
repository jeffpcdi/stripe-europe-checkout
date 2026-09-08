'use strict';

const { classifyCatalogCreationError } = require('./catalog-campaign-safety');

const CAMPAIGN_STAGES = Object.freeze([
  'queued', 'validating', 'upload', 'cover', 'creating_campaign', 'creating_adgroup', 'creating_ad',
  'waiting_pixel_purchase', 'verifying_entities', 'ready_paused', 'activating', 'ready_active',
  'partial', 'failed', 'cancelled',
]);
const TIKTOK_MIN_DAILY_BUDGET = 50;
// O overview disponível confirma apenas a contagem agregada de aprovados.
// Quatro é o piso para preparar Catalog Ads; disponibilidade/estoque por SKU
// ainda precisam ser validados pelo TikTok quando o conector expuser detalhe.
const TIKTOK_MIN_APPROVED_PRODUCTS = 4;
const TIKTOK_PIXEL_EVENTS = Object.freeze([
  // A Events API chama a conversão de `Purchase`, mas algumas contas
  // expõem esse mesmo evento no Ads Manager como `SHOPPING`. O preflight
  // consulta o Pixel real e escolhe somente um enum que já foi recebido.
  'SHOPPING', 'ON_WEB_ORDER', 'INITIATE_ORDER', 'ON_WEB_CART', 'ON_WEB_DETAIL',
  'ON_WEB_REGISTER', 'LANDING_PAGE_VIEW',
]);

function catalogError(code, userMessage, options) {
  const opts = options || {};
  const err = new Error(opts.message || userMessage);
  err.code = String(code || 'CATALOG_ERROR');
  err.status = Number(opts.status) || 400;
  err.step = opts.stage || null;
  err.userMessage = String(userMessage || 'Não foi possível concluir a operação.');
  err.retryable = opts.retryable === true;
  err.suggestedAction = opts.suggestedAction || null;
  err.providerRequestId = opts.providerRequestId || null;
  err.createdIds = opts.createdIds || null;
  return err;
}

function serializeCatalogError(err, fallbackStage) {
  const value = err || {};
  const stage = value.step || fallbackStage || 'failed';
  const classified = classifyCatalogCreationError(value);
  return {
    code: String(value.code || classified.code || ('CATALOG_' + String(stage).toUpperCase() + '_FAILED')).slice(0, 120),
    stage,
    message: String(value.message || 'erro inesperado').slice(0, 500),
    userMessage: String(value.userMessage || classified.userMessage || humanizeStage(stage)).slice(0, 500),
    retryable: value.retryable !== undefined ? value.retryable !== false : classified.retryable !== false,
    safeAutomaticRetry: value.safeAutomaticRetry === true || classified.safeAutomaticRetry === true,
    suggestedAction: value.suggestedAction || classified.suggestedAction || suggestedAction(stage),
    providerRequestId: value.providerRequestId || classified.providerRequestId || null,
    createdIds: value.createdIds || null,
  };
}

function humanizeStage(stage) {
  if (stage === 'upload') return 'O vídeo ainda está sendo processado pelo TikTok.';
  if (stage === 'cover') return 'O vídeo foi enviado, mas a capa automática ainda não ficou pronta.';
  if (stage === 'campaign') return 'A campanha não pôde ser criada no TikTok.';
  if (stage === 'adgroup') return 'A campanha foi criada, mas o TikTok recusou o conjunto de anúncios.';
  if (stage === 'ad') return 'A campanha e o conjunto foram criados, mas o TikTok recusou o anúncio.';
  if (stage === 'verify') return 'A estrutura foi criada, mas não foi possível confirmá-la no TikTok.';
  if (stage === 'activate') return 'A estrutura foi criada e mantida pausada, mas a ativação ainda não foi confirmada.';
  return 'Não foi possível concluir a operação de catálogo.';
}

function suggestedAction(stage) {
  if (stage === 'upload' || stage === 'cover') return 'A dashboard tentará novamente usando o mesmo vídeo. Não envie outro arquivo.';
  if (stage === 'adgroup') return 'Revise catálogo, Business Center, pixel, evento e o tipo de Catalog Ads antes de retomar.';
  if (stage === 'ad') return 'Revise produto, identidade, texto e CTA antes de retomar. Product Link não usa URL manual.';
  if (stage === 'verify') return 'Atualize a conexão e tente verificar novamente.';
  if (stage === 'activate') return 'A dashboard repetirá a ativação com a mesma hierarquia; não recrie a campanha.';
  return 'Revise os campos destacados e tente novamente.';
}

function step(id, label, state, detail) {
  return { id, label, state, detail: detail || '' };
}

function computeReadiness(catalog, products, context) {
  const cat = catalog || {};
  const rows = Array.isArray(products) ? products : [];
  const ctx = context || {};
  const validCount = rows.filter((p) => p && p.valid).length;
  const invalidCount = Math.max(0, rows.length - validCount);
  const audit = cat.audit || null;
  const approved = Number(audit && audit.approved) || 0;
  const pending = Number(audit && audit.pending) || 0;
  const rejected = Number(audit && audit.rejected) || 0;
  const remoteTotal = Number(audit && audit.total) || (approved + pending + rejected);
  const approvedMissing = Math.max(0, TIKTOK_MIN_APPROVED_PRODUCTS - approved);
  const hasMinimumApproved = approved >= TIKTOK_MIN_APPROVED_PRODUCTS;
  const linked = Boolean(cat.tiktokCatalogId && cat.bcId);
  const verified = linked && cat.linkStatus === 'verified';
  const advertiserReady = Boolean(ctx.advertiserId);
  const syncedAt = cat.syncedAt ? new Date(cat.syncedAt).getTime() : 0;
  const catalogUpdatedAt = cat.updatedAt ? new Date(cat.updatedAt).getTime() : 0;
  const hasUnpublishedChanges = verified && ((!syncedAt || catalogUpdatedAt > syncedAt) || rows.some((product) => {
    const updatedAt = product && product.updatedAt ? new Date(product.updatedAt).getTime() : 0;
    return !syncedAt || updatedAt > syncedAt;
  }));
  const localOnly = Math.max(0, validCount - remoteTotal);
  const remoteOnly = Math.max(0, remoteTotal - validCount);
  // Para campanhas com escopo ALL, o catálogo remoto é a fonte operacional:
  // o TikTok usará apenas os produtos que ele próprio confirmou. Alterações
  // locais continuam visíveis para revisão/sincronização, mas não bloqueiam
  // uma campanha pausada quando já existem produtos remotos suficientes.
  const remoteCatalogReady = verified && hasMinimumApproved;
  const productsReady = validCount > 0 || remoteTotal > 0;
  const productDetail = remoteTotal > 0
    ? `${remoteTotal} ${remoteTotal === 1 ? 'produto' : 'produtos'} no TikTok${localOnly > 0 ? ` · ${localOnly} ${localOnly === 1 ? 'item salvo' : 'itens salvos'} apenas na dashboard` : ''}`
    : validCount > 0
      ? `${validCount} ${validCount === 1 ? 'produto válido' : 'produtos válidos'} para enviar`
      : rows.length
        ? `${invalidCount} produto(s) precisam de correção`
        : 'Importe o primeiro produto';
  const approvedLabel = `${approved} ${approved === 1 ? 'aprovado' : 'aprovados'}`;
  const reviewDetail = hasMinimumApproved
    ? `${approvedLabel} no TikTok${localOnly > 0 ? ` · campanhas usarão somente os ${remoteTotal} confirmados` : ''}`
    : approved > 0
      ? `${approvedLabel}; faltam ${approvedMissing} para o mínimo de ${TIKTOK_MIN_APPROVED_PRODUCTS}`
      : pending > 0
        ? `${pending} em análise; são necessários ${TIKTOK_MIN_APPROVED_PRODUCTS} aprovados`
        : rejected > 0
          ? `${rejected} rejeitado(s); são necessários ${TIKTOK_MIN_APPROVED_PRODUCTS} aprovados`
          : `Aguardando no mínimo ${TIKTOK_MIN_APPROVED_PRODUCTS} produtos aprovados`;

  const steps = [
    step('products', 'Produtos', productsReady ? 'done' : rows.length ? 'blocked' : 'waiting', productDetail),
    step('link', 'Catálogo TikTok', verified ? 'done' : cat.linkStatus === 'error' ? 'blocked' : linked ? 'active' : 'waiting',
      verified ? `ID ${cat.tiktokCatalogId} verificado` : cat.linkError || (linked ? 'Vínculo ainda não verificado' : 'Conecte um catálogo existente')),
    step('review', 'Análise do TikTok', hasMinimumApproved ? 'done' : pending > 0 ? 'active' : approved > 0 || rejected > 0 ? 'blocked' : 'waiting',
      reviewDetail),
    step('advertiser', 'Conta de anúncio', advertiserReady ? 'done' : 'waiting',
      advertiserReady ? `Advertiser ${ctx.advertiserId}` : 'Selecione a conta que criará a campanha'),
  ];

  let state = 'draft';
  let nextAction = 'add_products';
  if (remoteCatalogReady && !advertiserReady) { state = 'ready_tiktok'; nextAction = 'select_advertiser'; }
  else if (remoteCatalogReady) { state = 'ready_for_campaign'; nextAction = 'create_campaign'; }
  else if (!rows.length && !remoteTotal) { state = 'draft'; nextAction = 'add_products'; }
  else if (!rows.length) { state = 'blocked'; nextAction = 'refresh_audit'; }
  else if (!validCount) { state = 'needs_review'; nextAction = 'fix_products'; }
  else if (validCount && !linked) { state = 'ready_local'; nextAction = 'connect_tiktok'; }
  else if (linked && !verified) { state = cat.linkStatus === 'error' ? 'blocked' : 'verifying_link'; nextAction = 'verify_link'; }
  else if (verified && (hasUnpublishedChanges || (!audit && !syncedAt))) { state = 'ready_to_sync'; nextAction = 'sync'; }
  else if (verified && !audit) { state = 'processing_tiktok'; nextAction = 'refresh_audit'; }
  else if (verified && pending > 0) { state = 'processing_tiktok'; nextAction = 'refresh_audit'; }
  else if (verified && !hasMinimumApproved) { state = 'blocked'; nextAction = approved > 0 || rejected > 0 ? 'fix_products' : 'sync'; }
  else if (!advertiserReady) { state = 'ready_tiktok'; nextAction = 'select_advertiser'; }
  else { state = 'ready_for_campaign'; nextAction = 'create_campaign'; }

  return {
    state,
    readyForCampaign: state === 'ready_for_campaign',
    nextAction,
    counts: {
      total: rows.length, valid: validCount, invalid: invalidCount,
      approved, pending, rejected, remoteTotal, localOnly, remoteOnly,
      minimumApproved: TIKTOK_MIN_APPROVED_PRODUCTS, approvedMissing,
    },
    hasUnpublishedChanges,
    steps,
  };
}

function normalizeCampaignSpec(input, catalog) {
  const value = input || {};
  const cat = catalog || {};
  const name = String(value.name || cat.name || 'Catálogo').trim().slice(0, 120);
  const budgetAmount = Number(value.budgetAmount);
  if (!name) throw catalogError('CATALOG_CAMPAIGN_NAME_REQUIRED', 'Informe o nome da campanha.');
  if (!(budgetAmount >= TIKTOK_MIN_DAILY_BUDGET)) {
    throw catalogError(
      'CATALOG_CAMPAIGN_BUDGET_BELOW_MINIMUM',
      `O orçamento mínimo aceito pelo TikTok é ${cat.currency || 'USD'} ${TIKTOK_MIN_DAILY_BUDGET} por dia.`,
      { status: 400, retryable: false },
    );
  }
  const budgetType = value.budgetType === 'lifetime' ? 'lifetime' : 'daily';
  if (budgetType === 'lifetime' && !/^\d{4}-\d{2}-\d{2}/.test(String(value.endDate || ''))) {
    throw catalogError('CATALOG_CAMPAIGN_END_DATE_REQUIRED', 'Orçamento total exige data de término.');
  }
  const budgetOptimization = value.budgetOptimization === 'campaign' ? 'campaign' : 'adgroup';
  const bidStrategy = value.bidStrategy === 'cost_cap' ? 'cost_cap' : 'lowest_cost';
  const bidAmount = Number(value.bidAmount);
  if (bidStrategy === 'cost_cap' && !(bidAmount > 0)) {
    throw catalogError(
      'CATALOG_CAMPAIGN_BID_AMOUNT_REQUIRED',
      'Informe um custo-alvo por compra maior que zero.',
      { status: 400, retryable: false },
    );
  }
  const requestedDeliveryMode = String(value.deliveryMode || 'standard').trim().toLowerCase();
  if (!['standard', 'accelerated'].includes(requestedDeliveryMode)) {
    throw catalogError(
      'CATALOG_CAMPAIGN_DELIVERY_MODE_INVALID',
      'Selecione entrega padrão ou acelerada.',
      { status: 400, retryable: false },
    );
  }
  if (requestedDeliveryMode === 'accelerated' && budgetOptimization !== 'adgroup') {
    throw catalogError(
      'CATALOG_CAMPAIGN_ACCELERATED_REQUIRES_ABO',
      'A entrega acelerada só está disponível com orçamento no conjunto (ABO).',
      { status: 400, retryable: false },
    );
  }
  if (requestedDeliveryMode === 'accelerated' && bidStrategy !== 'cost_cap') {
    throw catalogError(
      'CATALOG_CAMPAIGN_ACCELERATED_REQUIRES_COST_CAP',
      'A entrega acelerada exige custo-alvo por compra.',
      { status: 400, retryable: false },
    );
  }
  const productScope = ['all', 'product_set', 'specific'].includes(value.productScope) ? value.productScope : 'all';
  const itemGroupIds = Array.isArray(value.itemGroupIds || value.productIds)
    ? (value.itemGroupIds || value.productIds).map((v) => String(v || '').trim()).filter(Boolean).slice(0, 100) : [];
  if (productScope === 'specific' && !itemGroupIds.length) {
    throw catalogError('CATALOG_PRODUCTS_REQUIRED', 'Selecione ao menos um produto para o anúncio.');
  }
  if (productScope === 'specific' && itemGroupIds.some((itemGroupId) => itemGroupId.length > 100 || /[\r\n,]/.test(itemGroupId))) {
    throw catalogError('CATALOG_ITEM_GROUP_ID_INVALID', 'Os IDs dos produtos devem corresponder ao item_group_id do feed.');
  }
  const productSetId = String(value.productSetId || '').trim();
  if (productScope === 'product_set' && !productSetId) {
    throw catalogError('CATALOG_PRODUCT_SET_REQUIRED', 'Informe o conjunto de produtos do TikTok.');
  }
  if (productScope === 'product_set' && !/^\d{6,30}$/.test(productSetId)) {
    throw catalogError('CATALOG_PRODUCT_SET_INVALID', 'Informe um Product Set ID numérico válido do TikTok.');
  }
  // Product Link não é uma URL do anúncio: é o destino individual guardado no
  // campo `link` de cada item do catálogo. O criativo é um vídeo vertical com
  // o próprio áudio embutido; não existe música, capa ou URL de anúncio para o
  // usuário preencher manualmente.
  const videoUrl = String(value.videoUrl || '').trim();
  if (!/^https:\/\/[^\s]+$/i.test(videoUrl)) {
    throw catalogError(
      'CATALOG_VIDEO_REQUIRED',
      'Envie um vídeo MP4 ou MOV para criar a campanha de catálogo.',
      { status: 400, retryable: false },
    );
  }
  const identityType = String(value.identityType || '').trim().toUpperCase();
  const identityId = String(value.identityId || '').trim().slice(0, 120);
  const identityBcId = String(value.identityBcId || '').trim();
  const hasIdentityChoice = Boolean(identityId || identityType || identityBcId);
  if (hasIdentityChoice && !(identityId && identityType && identityBcId)) {
    throw catalogError('CATALOG_IDENTITY_INCOMPLETE', 'Selecione novamente o perfil autorizado do Business Center.');
  }
  if (identityType && identityType !== 'BC_AUTH_TT') {
    throw catalogError('CATALOG_IDENTITY_TYPE_INVALID', 'Campanhas de catálogo aceitam somente perfis autorizados do Business Center.');
  }
  if (identityBcId && !/^\d{6,30}$/.test(identityBcId)) {
    throw catalogError('CATALOG_IDENTITY_BC_INVALID', 'O Business Center do perfil selecionado é inválido.');
  }
  const pixelId = String(value.pixelId || '').trim();
  if (!/^\d{6,30}$/.test(pixelId)) {
    throw catalogError(
      pixelId ? 'CATALOG_PIXEL_ID_INVALID' : 'CATALOG_PIXEL_REQUIRED',
      pixelId
        ? 'Informe um Pixel ID numérico válido do TikTok.'
        : 'Informe o Pixel ID do TikTok para otimizar a campanha para conversão.',
      { status: 400, retryable: false },
    );
  }
  const rawPixelEvent = String(value.pixelEvent || 'ON_WEB_ORDER').trim().toUpperCase();
  // `PURCHASE` aparecia em versões antigas da UI; convertemos para o enum
  // canônico exigido pelo TikTok sem adivinhar eventos desconhecidos.
  const pixelEvent = rawPixelEvent === 'PURCHASE' ? 'ON_WEB_ORDER' : rawPixelEvent;
  if (!TIKTOK_PIXEL_EVENTS.includes(pixelEvent)) {
    throw catalogError(
      'CATALOG_PIXEL_EVENT_INVALID',
      'Selecione um evento de otimização válido do Pixel TikTok.',
      { status: 400, retryable: false },
    );
  }
  const countries = value.countries === undefined ? [value.country || cat.country || 'BR'] : value.countries;
  const languages = value.languages === undefined ? [] : value.languages;
  if (!Array.isArray(countries) || !countries.length || countries.length > 30 || countries.some((code) => !/^[a-z]{2}$/i.test(String(code)))) {
    throw catalogError('CATALOG_COUNTRIES_INVALID', 'Escolha ao menos um país válido.');
  }
  if (!Array.isArray(languages) || languages.length > 10 || languages.some((code) => !/^[a-z]{2}$/i.test(String(code)))) {
    throw catalogError('CATALOG_LANGUAGES_INVALID', 'Escolha um idioma válido.');
  }
  const autoActivate = value.autoActivate === true;
  return {
    name, budgetAmount, budgetType, endDate: value.endDate || undefined,
    budgetOptimization,
    bidStrategy,
    bidAmount: bidStrategy === 'cost_cap' ? bidAmount : undefined,
    deliveryMode: requestedDeliveryMode,
    country: String(countries[0]).toUpperCase(),
    countries: [...new Set(countries.map((code) => String(code).toUpperCase()))],
    languages: [...new Set(languages.map((code) => String(code).toLowerCase()))],
    productScope, itemGroupIds, productIds: itemGroupIds, productSetId: productSetId || undefined,
    videoUrl,
    identityId: identityId || undefined, identityType: identityType || undefined,
    identityBcId: identityBcId || undefined,
    pixelId,
    pixelEvent,
    autoActivate,
    text: String(value.text || '').trim().slice(0, 100) || undefined,
    callToAction: String(value.callToAction || 'SHOP_NOW').trim().toUpperCase(),
    strategy: 'catalog_video_product_link', destination: 'PRODUCT_LINK', creativeMode: 'SINGLE_VIDEO',
    status: autoActivate ? 'active' : 'paused',
  };
}

// Modo Turbo: nomes numerados do lote de campanhas ("Prefixo — VSA 01" … "NN").
// Zero-padding acompanha o tamanho do lote (01…50, 001…100) para ordenar bem
// no Ads Manager. Função pura para o teste cobrir sem tocar rede/banco.
const CATALOG_CAMPAIGN_BATCH_MAX = 50;
function buildCampaignBatchNames(prefix, count) {
  const total = Number(count);
  if (!Number.isInteger(total) || total < 1 || total > CATALOG_CAMPAIGN_BATCH_MAX) {
    throw catalogError(
      'CATALOG_CAMPAIGN_BATCH_COUNT_INVALID',
      `Informe quantas campanhas criar (1 a ${CATALOG_CAMPAIGN_BATCH_MAX}).`,
      { status: 400, retryable: false },
    );
  }
  const base = String(prefix || '').trim();
  if (!base) throw catalogError('CATALOG_CAMPAIGN_NAME_REQUIRED', 'Informe o prefixo do nome das campanhas.');
  const pad = Math.max(2, String(total).length);
  return Array.from({ length: total }, (_, index) => {
    const suffix = ` ${String(index + 1).padStart(pad, '0')}`;
    // Reserva o final para a numeração. Cortar a string pronta removia o
    // sufixo de prefixos longos e fazia o lote inteiro colidir no mesmo nome.
    return `${base.slice(0, Math.max(1, 120 - suffix.length)).trimEnd()}${suffix}`;
  });
}

module.exports = {
  CAMPAIGN_STAGES,
  CATALOG_CAMPAIGN_BATCH_MAX,
  TIKTOK_MIN_DAILY_BUDGET,
  TIKTOK_MIN_APPROVED_PRODUCTS,
  TIKTOK_PIXEL_EVENTS,
  catalogError,
  serializeCatalogError,
  computeReadiness,
  normalizeCampaignSpec,
  buildCampaignBatchNames,
};
