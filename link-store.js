// ── Links de Checkout externos (/go/:slug) ────────────────────────────────
// Nenhum checkout vive neste projeto: cada link aponta para 1+ URLs externas
// (variantes de teste A/B com pesos). A fonte de verdade é o Neon (tabela
// links), com cache quente em memória — mesmo padrão do pixel-store.
// Estrutura de um link:
//   { slug, nome, dominio, dominioValidado, variantes: [{ id, nome, url, peso,
//     clicks, conversions, revenue: { EUR: cents } }], ativo, criadoEm }
const dns = require('dns').promises;
const db = require('./db');

let cache = []; // lista de links em memória
// Domínios já validados nesta sessão (host → ISO). Permite validar ANTES de
// salvar o link: o save() consulta aqui e já grava dominioValidado=true.
const validatedDomains = new Map();

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || ('link-' + Date.now().toString(36));
}

function validUrl(u) {
  return /^https:\/\/[^\s]+\.[^\s]+/i.test(String(u || '').trim());
}

// Extrai o hostname de uma URL/domínio digitado (aceita com ou sem https://)
function hostnameOf(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  try { return new URL(s.includes('://') ? s : 'https://' + s).hostname; }
  catch (_) { return null; }
}

// Normaliza um link vindo da dashboard/banco.
function normalize(slug, raw) {
  raw = raw || {};
  const variantes = (Array.isArray(raw.variantes) ? raw.variantes : [])
    .filter((v) => v && validUrl(v.url))
    .slice(0, 10)
    .map((v, i) => ({
      id: String(v.id || 'v' + (i + 1)).slice(0, 40),
      nome: String(v.nome || 'Variante ' + (i + 1)).slice(0, 60),
      url: String(v.url).trim().slice(0, 500),
      // destino alternativo para celular/tablet (opcional): computador vai
      // para `url`, mobile vai para `urlMobile` quando preenchida
      urlMobile: validUrl(v.urlMobile) ? String(v.urlMobile).trim().slice(0, 500) : null,
      urlWhitePage: validUrl(v.urlWhitePage) ? String(v.urlWhitePage).trim().slice(0, 500) : null,
      peso: Math.max(0, Math.min(100, Math.round(Number(v.peso) || 0))) || Math.round(100 / (raw.variantes.length || 1)),
      clicks: Math.max(0, Number(v.clicks) || 0),
      conversions: Math.max(0, Number(v.conversions) || 0),
      revenue: (v.revenue && typeof v.revenue === 'object') ? v.revenue : {}
    }));
  return {
    slug,
    nome: String(raw.nome || slug).slice(0, 80),
    dominio: hostnameOf(raw.dominio) || (variantes[0] ? hostnameOf(variantes[0].url) : null),
    dominioValidado: raw.dominioValidado === true,
    dominioValidadoEm: raw.dominioValidadoEm || null,
    variantes,
    // Roteamento cloak: revisores/bots vão para a white page;
    // usuários reais vão para a offer page (url normal das variantes).
    urlWhitePage: validUrl(raw.urlWhitePage) ? String(raw.urlWhitePage).trim().slice(0, 500) : null,
    // Allowlist de países (ISO-2 maiúsculo). Vazio = todos os países liberados.
    // Visitante fora da lista vai para a white page (sem passar pelo motor de score).
    paises: (Array.isArray(raw.paises) ? raw.paises : [])
      .map((c) => String(c || '').trim().toUpperCase())
      .filter((c) => /^[A-Z]{2}$/.test(c))
      .filter((c, i, a) => a.indexOf(c) === i)
      .slice(0, 30),
    // Pixel que dispara nesse link (slug do pixel-store). Vazio = dispatchToAll por rota.
    pixelSlug: String(raw.pixelSlug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
    ativo: raw.ativo !== false,
    criadoEm: raw.criadoEm || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ── Boot: hidrata do Neon ──────────────────────────────────────────────────
async function init() {
  if (!db.enabled) { console.log('[links] Neon desativado — links só em memória.'); return 0; }
  try {
    const rows = await db.loadLinks();
    cache = (rows || []).map((r) => normalize(r.slug, r));
    console.log('[links] ' + cache.length + ' link(s) de checkout carregado(s).');
  } catch (e) { console.error('[links] init:', e.message); }
  return cache.length;
}

// ── API pública ────────────────────────────────────────────────────────────
function list() { return cache.slice(); }
function get(slug) { return cache.find((l) => l.slug === slugify(slug)) || null; }

async function save(input) {
  input = input || {};
  const slug = slugify(input.slug || input.nome);
  if (!slug) throw new Error('nome é obrigatório');
  const existing = get(slug);
  const merged = normalize(slug, Object.assign({}, existing || {}, input, { slug }));
  if (!merged.variantes.length) throw new Error('pelo menos 1 variante com URL https:// válida é obrigatória');
  // preserva contadores existentes por id de variante (edição não zera stats)
  if (existing) {
    merged.criadoEm = existing.criadoEm;
    merged.variantes.forEach((v) => {
      const prev = existing.variantes.find((p) => p.id === v.id);
      if (prev) { v.clicks = prev.clicks; v.conversions = prev.conversions; v.revenue = prev.revenue; }
    });
    // se o domínio mudou, a validação anterior deixa de valer
    if (existing.dominio !== merged.dominio) { merged.dominioValidado = false; merged.dominioValidadoEm = null; }
    else { merged.dominioValidado = existing.dominioValidado; merged.dominioValidadoEm = existing.dominioValidadoEm; }
  }
  // domínio validado antes do save (fluxo normal do formulário)
  if (!merged.dominioValidado && merged.dominio && validatedDomains.has(merged.dominio)) {
    merged.dominioValidado = true;
    merged.dominioValidadoEm = validatedDomains.get(merged.dominio);
  }
  const idx = cache.findIndex((l) => l.slug === slug);
  if (idx >= 0) cache[idx] = merged; else cache.push(merged);
  if (db.enabled) await db.upsertLink(slug, merged);
  return merged;
}

async function remove(slug) {
  slug = slugify(slug);
  cache = cache.filter((l) => l.slug !== slug);
  if (db.enabled) await db.deleteLink(slug);
  return true;
}

// ── Escolha de variante por pesos, determinística por visitante ───────────
// Hash FNV-1a do visitorId+slug → bucket estável em [0,100). O mesmo
// visitante SEMPRE cai na mesma variante (mesmo se limpar o cookie).
function bucketOf(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h % 100;
}
function pickVariant(link, visitorId) {
  const vs = link.variantes.filter((v) => v.peso > 0);
  const pool = vs.length ? vs : link.variantes;
  const total = pool.reduce((a, v) => a + (v.peso || 1), 0);
  const roll = (visitorId ? bucketOf(visitorId + '|' + link.slug) : Math.random() * 100) / 100 * total;
  let acc = 0;
  for (const v of pool) {
    acc += (v.peso || 1);
    if (roll < acc) return v;
  }
  return pool[pool.length - 1];
}

// ── Contadores (persistidos no Neon em write-through, debounced) ──────────
const _dirty = new Set();
let _flushTimer = null;
function persistSoon(slug) {
  _dirty.add(slug);
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    const slugs = Array.from(_dirty); _dirty.clear();
    slugs.forEach((s) => {
      const link = get(s);
      if (link && db.enabled) db.upsertLink(s, link);
    });
  }, 1000);
  if (_flushTimer.unref) _flushTimer.unref();
}

function recordClick(slug, variantId) {
  const link = get(slug);
  if (!link) return;
  const v = link.variantes.find((x) => x.id === variantId);
  if (!v) return;
  v.clicks = (v.clicks || 0) + 1;
  persistSoon(link.slug);
}

function recordConversion(slug, variantId, amountCents, currency) {
  const link = get(slug);
  if (!link) return;
  const v = link.variantes.find((x) => x.id === variantId) || link.variantes[0];
  if (!v) return;
  v.conversions = (v.conversions || 0) + 1;
  const cur = String(currency || 'eur').toUpperCase();
  v.revenue[cur] = (v.revenue[cur] || 0) + (amountCents || 0);
  persistSoon(link.slug);
}

// ── Validação de domínio: DNS resolve + resposta HTTP real ────────────────
async function validateDomain(input) {
  const host = hostnameOf(input);
  if (!host || !/\./.test(host)) return { ok: false, error: 'domínio inválido' };
  // 1. DNS: o domínio existe?
  try {
    await dns.lookup(host);
  } catch (_) {
    return { ok: false, host, dns: false, error: 'domínio não resolve (DNS)' };
  }
  // 2. HTTP: o site responde? (HEAD com fallback GET, timeout 8s)
  let httpOk = false, status = null;
  for (const method of ['HEAD', 'GET']) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch('https://' + host + '/', { method, redirect: 'follow', signal: ctrl.signal });
      clearTimeout(t);
      status = r.status;
      if (r.status < 500) { httpOk = true; break; } // 2xx/3xx/4xx = servidor vivo
    } catch (_) { /* tenta o próximo método */ }
  }
  if (!httpOk) return { ok: false, host, dns: true, http: false, status, error: 'domínio resolve mas não responde HTTPS' };
  // 3. marca como validado em todos os links com este domínio
  const now = new Date().toISOString();
  validatedDomains.set(host, now); // vale também para links salvos depois
  cache.forEach((l) => {
    if (l.dominio === host) {
      l.dominioValidado = true;
      l.dominioValidadoEm = now;
      persistSoon(l.slug);
    }
  });
  return { ok: true, host, dns: true, http: true, status, validadoEm: now };
}

module.exports = {
  init, list, get, save, remove, pickVariant,
  recordClick, recordConversion, validateDomain, slugify
};
