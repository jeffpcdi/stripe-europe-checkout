const domain = require('./catalog-product-automation');

// Dependências injetáveis permitem validar timeout/retry e isolamento sem
// conectar o teste ao banco, ao site do produto ou a uma conta de anúncios.
async function importProductCatalog({ accountId, advertiserId, body, store, inspect, validateCreatives, startSync }) {
  const input = domain.normalizeInput(body);
  let catalog = await store.getProductCatalogRequest(accountId, advertiserId, input.batchKey);
  if (catalog && catalog.automation.requestFingerprint !== input.fingerprint) {
    throw domain.error('CATALOG_REQUEST_CONFLICT', 'Esta tentativa pertence a outra configuração. Inicie uma nova criação.', 409);
  }
  if (!catalog) {
    await validateCreatives(input.creatives);
    const inspected = await inspect(input.url);
    const plan = domain.buildPlan(input, inspected);
    if (!plan.valid) {
      const err = domain.error('CATALOG_PRODUCT_INCOMPLETE', 'Complete os dados que a página não informou.', 422);
      err.product = plan.product;
      err.fields = plan.errors;
      throw err;
    }
    catalog = await store.createProductCatalog(accountId, advertiserId, input, plan);
  }
  let syncRun = null;
  let syncIssue = null;
  if (body.syncToTikTok !== false) {
    try { syncRun = await startSync(catalog); }
    catch (err) { syncIssue = { code: err.code || 'CATALOG_SYNC_UNAVAILABLE', message: err.userMessage || err.message || 'Não foi possível iniciar a sincronização. Tente novamente.' }; }
    await store.setCatalogSyncIssue(accountId, advertiserId, catalog.id, syncIssue);
  }
  return { catalog: await store.getCatalog(accountId, advertiserId, catalog.id) || catalog,
    syncStarted: Boolean(syncRun), syncRun, syncIssue };
}
module.exports = { importProductCatalog };
