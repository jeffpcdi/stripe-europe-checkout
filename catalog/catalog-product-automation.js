// Um produto real, quatro registros de feed e uma biblioteca de criativos.
// Os registros compartilham os mesmos dados comerciais; nunca inventamos
// tamanhos, cores, preços ou promessas para diferenciar as cópias.
const crypto = require('crypto');
const feed = require('../ads-catalog-feed');
const storage = require('../ads-storage');

const ITEM_COUNT = 4;
const MAX_CREATIVES = 50;
const editableFields = ['title', 'description', 'brand', 'price', 'image_link'];
function error(code, message, status = 400) {
  return Object.assign(new Error(message), { code, status });
}
function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
function sourceUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch (_) { throw error('CATALOG_URL_INVALID', 'Informe o link HTTPS do produto.'); }
  if (url.protocol !== 'https:' || url.username || url.password || !storage.isPublicDownloadHostname(url.hostname)) {
    throw error('CATALOG_URL_INVALID', 'Use o link HTTPS público de um único produto.');
  }
  url.hash = '';
  return url.toString();
}
function normalizeCreatives(input) {
  if (!Array.isArray(input) || input.length > MAX_CREATIVES) throw error('CATALOG_CREATIVES_LIMIT', 'Adicione até 50 vídeos por catálogo.');
  const seen = new Set();
  return input.map((item) => {
    const url = sourceUrl(item && item.url);
    if (!/\.(mp4|mov)$/i.test(new URL(url).pathname)) throw error('CATALOG_CREATIVE_INVALID', 'Use vídeos MP4 ou MOV enviados à biblioteca.');
    const result = { id: 'creative_' + digest(url).slice(0, 24), url, name: String(item.name || 'Vídeo').trim().slice(0, 180) || 'Vídeo' };
    if (Number.isInteger(item.sortOrder) && item.sortOrder >= 0 && item.sortOrder < 1000000) result.sortOrder = item.sortOrder;
    return result;
  }).filter((item) => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });
}
function normalizeInput(body = {}) {
  const url = sourceUrl(body.url);
  const overrides = {};
  for (const field of editableFields) {
    if (body.product && body.product[field] != null) overrides[field] = String(body.product[field]).trim();
  }
  if (body.brand) overrides.brand = String(body.brand).trim();
  const country = String(body.country || 'BR').toUpperCase();
  const currency = String(body.currency || '').toUpperCase();
  if (!/^[A-Z]{2}$/.test(country) || (currency && !/^[A-Z]{3}$/.test(currency))) throw error('CATALOG_MARKET_INVALID', 'Revise o país e a moeda do catálogo.');
  const creatives = normalizeCreatives(body.creatives || []);
  const name = String(body.name || '').trim().slice(0, 200);
  const fingerprint = digest(JSON.stringify({ url, overrides, country, currency, creatives, name }));
  const key = String(body.idempotencyKey || fingerprint).trim();
  if (!key || key.length > 200) throw error('CATALOG_REQUEST_INVALID', 'A identificação desta criação é inválida.');
  return { url, overrides, country, currency, creatives, name, fingerprint, batchKey: 'product-url:' + digest(key) };
}
function buildPlan(input, inspected) {
  const source = inspected.product || {};
  const currency = input.currency || String(source.currency || 'BRL').toUpperCase();
  const data = Object.assign({}, source, input.overrides);
  const price = String(data.price || '').trim().replace(',', '.');
  data.price = /^[0-9.]+\s+[A-Za-z]{3}$/.test(price) ? price.toUpperCase() : price ? price + ' ' + currency : '';
  data.title = String(data.title || '').trim().slice(0, 500);
  data.description = String(data.description || data.title).replace(/\s+/g, ' ').trim().slice(0, 10000);
  data.brand = String(data.brand || '').trim().slice(0, 100);
  data.link = input.url;
  data.condition = data.condition || 'new';
  data.availability = data.availability || 'in stock';
  if (data.image_link) {
    try { data.image_link = new URL(data.image_link, inspected.finalUrl || input.url).toString(); } catch (_) {}
  }
  delete data.currency;
  const prefix = 'URL-' + digest(input.url).slice(0, 16).toUpperCase();
  const products = Array.from({ length: ITEM_COUNT }, (_, index) => {
    const sku = prefix + '-' + String(index + 1).padStart(2, '0');
    return { ...data, sku_id: sku, item_group_id: sku };
  });
  const validation = feed.validateProduct(products[0], { currency });
  return { name: input.name || data.title, currency, country: input.country, products, product: data, errors: validation.errors, valid: validation.valid };
}
module.exports = { ITEM_COUNT, MAX_CREATIVES, normalizeInput, normalizeCreatives, buildPlan, error };
