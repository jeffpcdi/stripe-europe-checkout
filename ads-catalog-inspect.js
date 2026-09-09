'use strict';

const dns = require('node:dns').promises;
const net = require('node:net');

const MAX_HTML_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    return parts[0] === 10 || parts[0] === 127 || parts[0] === 0 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) ||
      parts[0] >= 224;
  }
  const normalized = ip.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') ||
    normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb');
}

async function assertPublicUrl(input) {
  let url;
  try { url = new URL(String(input || '').trim()); } catch (_) { throw Object.assign(new Error('URL inválida'), { status: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Use uma URL HTTP ou HTTPS'), { status: 400 });
  if (url.username || url.password) throw Object.assign(new Error('URL com credenciais não é permitida'), { status: 400 });
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) throw Object.assign(new Error('Endereço local não é permitido'), { status: 400 });
  const addresses = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) throw Object.assign(new Error('O endereço precisa ser público'), { status: 400 });
  return url;
}

function decodeHtml(value) {
  return String(value || '').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').trim();
}

function meta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name|itemprop)=["']${escaped}["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decodeHtml(match[1]); }
  return '';
}

function findProductJson(value) {
  if (!value || typeof value !== 'object') return null;
  if (Array.isArray(value)) { for (const child of value) { const found = findProductJson(child); if (found) return found; } return null; }
  const type = value['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return value;
  for (const child of Object.values(value)) {
    const found = findProductJson(child);
    if (found) return found;
  }
  return null;
}

function findProductJsonAll(value, out) {
  const rows = out || [];
  if (!value || typeof value !== 'object') return rows;
  if (Array.isArray(value)) {
    value.forEach((child) => findProductJsonAll(child, rows));
    return rows;
  }
  const type = value['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) rows.push(value);
  Object.values(value).forEach((child) => findProductJsonAll(child, rows));
  return rows;
}

function firstValue(value) {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstValue(item);
      if (found) return found;
    }
    return '';
  }
  if (value && typeof value === 'object') {
    return firstValue(value.url || value.contentUrl || value.value || '');
  }
  return String(value || '').trim();
}

function firstOffer(value) {
  const offer = Array.isArray(value) ? value[0] : value;
  if (!offer || typeof offer !== 'object') return {};
  if (offer.price || offer.lowPrice || offer.highPrice || offer.priceSpecification) return offer;
  return firstOffer(offer.offers);
}

function extractProduct(html, sourceUrl) {
  let structured = null;
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    try { structured = findProductJson(JSON.parse(match[1].trim())); } catch (_) { /* ignora JSON-LD inválido */ }
    if (structured) break;
  }
  const offer = firstOffer(structured?.offers);
  const priceSpec = firstOffer(offer.priceSpecification);
  const image = firstValue(structured?.image);
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const brand = firstValue(structured?.brand && (structured.brand.name || structured.brand));
  return {
    title: decodeHtml(structured?.name || meta(html, 'og:title') || (titleMatch && titleMatch[1]) || ''),
    description: decodeHtml(structured?.description || meta(html, 'og:description') || meta(html, 'description') || ''),
    image_link: image || meta(html, 'og:image') || meta(html, 'image')
      ? absoluteUrl(image || meta(html, 'og:image') || meta(html, 'image'), sourceUrl) : '',
    price: String(offer.price || offer.lowPrice || offer.highPrice || priceSpec.price || meta(html, 'product:price:amount') || meta(html, 'price') || '').trim(),
    currency: String(offer.priceCurrency || priceSpec.priceCurrency || meta(html, 'product:price:currency') || meta(html, 'priceCurrency') || '').trim().toUpperCase(),
    availability: /outofstock/i.test(String(offer.availability || '')) ? 'out of stock' : 'in stock',
    brand: String(brand || meta(html, 'product:brand') || '').trim(),
    sku_id: String(structured?.sku || structured?.mpn || structured?.productID || '').trim(),
    link: sourceUrl,
  };
}

function absoluteUrl(value, base) {
  try { return new URL(String(value || ''), base).toString(); } catch (_) { return String(value || ''); }
}

function productFromJsonLd(product, sourceUrl, fallback) {
  const offer = firstOffer(product && product.offers);
  const spec = firstOffer(offer.priceSpecification);
  const brand = firstValue(product && product.brand && (product.brand.name || product.brand));
  return {
    sku_id: String(product && (product.sku || product.mpn || product.productID) || '').trim(),
    title: decodeHtml(product && product.name || ''),
    description: decodeHtml(product && product.description || ''),
    image_link: absoluteUrl(firstValue(product && product.image), sourceUrl),
    price: String(offer.price || offer.lowPrice || offer.highPrice || spec.price || '').trim(),
    currency: String(offer.priceCurrency || spec.priceCurrency || fallback.currency || '').trim().toUpperCase(),
    availability: /outofstock/i.test(String(offer.availability || '')) ? 'out of stock' : 'in stock',
    brand: String(brand || fallback.brand || '').trim(),
    link: absoluteUrl(product && product.url || sourceUrl, sourceUrl),
  };
}

function extractProducts(html, sourceUrl) {
  const fallback = extractProduct(html, sourceUrl);
  const rows = [];
  const scripts = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(scripts)) {
    try {
      const products = findProductJsonAll(JSON.parse(match[1].trim()));
      products.forEach((product) => rows.push(productFromJsonLd(product, sourceUrl, fallback)));
    } catch (_) { /* JSON-LD inválido não invalida os demais blocos */ }
  }
  if (!rows.length && fallback.title) rows.push(fallback);
  const seen = new Set();
  return rows.filter((row) => {
    const key = String(row.sku_id || row.link || row.title).toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 50);
}

async function fetchPublic(url, options = {}) {
  let current = await assertPublicUrl(url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const response = await fetch(current, {
      method: options.method || 'GET', redirect: 'manual',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CatalogInspector/1.0)', Accept: options.accept || 'text/html,*/*;q=0.8' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location || redirect === 3) throw Object.assign(new Error('Redirecionamentos demais'), { status: 400 });
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    return { response, finalUrl: current.toString() };
  }
  throw Object.assign(new Error('Não foi possível acessar a URL'), { status: 400 });
}

async function previewProduct(url) {
  const { response, finalUrl } = await fetchPublic(url);
  if (!response.ok) throw Object.assign(new Error(`A página respondeu HTTP ${response.status}`), { status: 422 });
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw Object.assign(new Error('A URL não aponta para uma página HTML'), { status: 422 });
  const length = Number(response.headers.get('content-length') || 0);
  if (length > MAX_HTML_BYTES) throw Object.assign(new Error('A página é grande demais para importar'), { status: 413 });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_HTML_BYTES) throw Object.assign(new Error('A página é grande demais para importar'), { status: 413 });
  return { product: extractProduct(buffer.toString('utf8'), finalUrl), finalUrl };
}

async function readLimited(response, maxBytes) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw Object.assign(new Error('A resposta é grande demais para importar'), { status: 413 });
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > maxBytes) throw Object.assign(new Error('A resposta é grande demais para importar'), { status: 413 });
  return buffer;
}

async function previewCatalog(url) {
  const page = await fetchPublic(url);
  if (!page.response.ok) throw Object.assign(new Error(`A página respondeu HTTP ${page.response.status}`), { status: 422 });
  const type = page.response.headers.get('content-type') || '';
  if (!type.includes('text/html')) throw Object.assign(new Error('A URL não aponta para uma página HTML'), { status: 422 });
  const html = (await readLimited(page.response, MAX_HTML_BYTES)).toString('utf8');
  const finalUrl = page.finalUrl;
  const base = new URL(finalUrl);
  const fallback = extractProduct(html, finalUrl);

  // Shopify expõe um endpoint JSON da coleção. Ele passa pela mesma validação
  // de DNS/redirect do HTML; nunca fazemos fetch direto para host interno.
  if (base.pathname.includes('/collections/')) {
    const endpoint = base.origin + base.pathname.replace(/\/$/, '') + '/products.json?limit=50';
    try {
      const api = await fetchPublic(endpoint, { accept: 'application/json' });
      if (api.response.ok && (api.response.headers.get('content-type') || '').includes('json')) {
        const payload = JSON.parse((await readLimited(api.response, 3_000_000)).toString('utf8'));
        const products = (Array.isArray(payload.products) ? payload.products : []).map((product) => {
          const variant = Array.isArray(product.variants) ? product.variants[0] || {} : {};
          const image = Array.isArray(product.images) ? product.images[0] || {} : {};
          return {
            sku_id: String(variant.sku || variant.id || product.id || product.handle || ''),
            title: decodeHtml(product.title || ''),
            description: decodeHtml(String(product.body_html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').slice(0, 10000),
            price: String(variant.compare_at_price || variant.price || ''),
            sale_price: variant.compare_at_price ? String(variant.price || '') : '',
            currency: fallback.currency || '',
            condition: 'new',
            availability: variant.available === false ? 'out of stock' : 'in stock',
            link: absoluteUrl('/products/' + product.handle, base.origin),
            image_link: absoluteUrl(image.src || product.image && product.image.src || '', base.origin),
            brand: String(product.vendor || fallback.brand || '').trim(),
          };
        }).filter((product) => product.title && product.price);
        if (products.length) return { products, finalUrl, source: 'shopify_collection' };
      }
    } catch (_) { /* cai para JSON-LD da página */ }
  }
  return { products: extractProducts(html, finalUrl), finalUrl, source: 'html_jsonld' };
}

module.exports = { isPrivateIp, assertPublicUrl, extractProduct, extractProducts, previewProduct, previewCatalog, fetchPublic };
