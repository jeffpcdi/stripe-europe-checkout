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
  return {
    title: decodeHtml(structured?.name || meta(html, 'og:title') || (titleMatch && titleMatch[1]) || ''),
    description: decodeHtml(structured?.description || meta(html, 'og:description') || meta(html, 'description') || ''),
    image_link: String(image || meta(html, 'og:image') || meta(html, 'image') || '').trim(),
    price: String(offer.price || offer.lowPrice || offer.highPrice || priceSpec.price || meta(html, 'product:price:amount') || meta(html, 'price') || '').trim(),
    currency: String(offer.priceCurrency || priceSpec.priceCurrency || meta(html, 'product:price:currency') || meta(html, 'priceCurrency') || '').trim().toUpperCase(),
    availability: /outofstock/i.test(String(offer.availability || '')) ? 'out of stock' : 'in stock',
    link: sourceUrl,
  };
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

module.exports = { isPrivateIp, assertPublicUrl, extractProduct, previewProduct };
