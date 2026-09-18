// ── Links de Checkout externos (/go/:slug) ────────────────────────────────
// Nenhum checkout vive neste projeto: cada link aponta para 1+ URLs externas
// (variantes de teste A/B com pesos). A fonte de verdade é o Neon (tabela
// links), com cache quente em memória — mesmo padrão do pixel-store.
// Estrutura de um link:
//   { slug, nome, dominio, dominioValidado, variantes: [{ id, nome, url, peso,
//     clicks, conversions, revenue: { EUR: cents } }], ativo, criadoEm }
const dns = require('dns').promises;
const db = require('./db');
const abPredictor = require('./ab-predictor');
const domainSecurity = require('./domain-security');
const publicSlug = require('./public-slug');

let cache = []; // lista de links em memória
// Domínios já validados nesta sessão (host → ISO). Permite validar ANTES de
// salvar o link: o save() consulta aqui e já grava dominioValidado=true.
const validatedDomains = new Map();

function slugify(s) { return publicSlug.normalize(s); }

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
  const exp = raw.experiment && typeof raw.experiment === 'object' ? raw.experiment : {};
  return {
    slug,
    acc: raw.acc || raw.accountId || null, // conta dona (multi-tenant)
    nome: String(raw.nome || slug).slice(0, 80),
    // Domínio personalizado do link (rótulo/URL exibida). Vazio = domínio padrão
    // do app. NÃO cai mais para o host do checkout (isso gerava um "domínio não
    // validado" fantasma). O roteamento /go é por Host de entrada, não por aqui.
    dominio: hostnameOf(raw.dominio) || null,
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
    // Allowlist de idiomas (ISO-639-1 minúsculo: pt, es, en, it, fr, de).
    // Vazio = todos os idiomas liberados. Idioma do navegador fora da lista
    // → white page (mesmo tratamento dos países). Checagem instantânea via
    // header Accept-Language, sem custo de DNS.
    idiomas: (Array.isArray(raw.idiomas) ? raw.idiomas : [])
      .map((c) => String(c || '').trim().toLowerCase().split('-')[0])
      .filter((c) => /^[a-z]{2}$/.test(c))
      .filter((c, i, a) => a.indexOf(c) === i)
      .slice(0, 20),
    // Pixel que dispara nesse link (slug do pixel-store). Vazio = dispatchToAll por rota.
    pixelSlug: String(raw.pixelSlug || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40),
    ativo: raw.ativo !== false,
    // Item 531: arquivado = fora da lista padrão e do /go, mas histórico
    // (cliques/conversões/receita) preservado. Independente de `ativo`.
    arquivado: raw.arquivado === true,
    experiment: {
      enabled: exp.enabled === true,
      autoStop: exp.autoStop === true,
      minVisitors: Math.max(20, Math.min(1000000, Math.round(Number(exp.minVisitors) || 200))),
      minConversions: Math.max(2, Math.min(100000, Math.round(Number(exp.minConversions) || 10))),
      confidence: Math.max(0.8, Math.min(0.999, Number(exp.confidence) || 0.95)),
      minLiftPct: Math.max(0, Math.min(500, Number(exp.minLiftPct) || 5)),
      status: exp.status === 'concluded' ? 'concluded' : 'running',
      winnerId: String(exp.winnerId || '').slice(0, 40) || null,
      concludedAt: exp.concludedAt || null,
      lastEvaluation: exp.lastEvaluation && typeof exp.lastEvaluation === 'object' ? exp.lastEvaluation : null,
    },
    criadoEm: raw.criadoEm || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

// ── Boot: hidrata TODAS as contas do Neon ──────────────────────────────────
async function init() {
  if (!db.enabled) { console.log('[links] Neon desativado — links só em memória.'); return 0; }
  try {
    const res = await db.loadLinks(null); // todas as contas
    if (res && res.ok) {
      cache = (res.data || []).map((r) => normalize(r.slug, r));
      console.log('[links] ' + cache.length + ' link(s) de checkout carregado(s).');
    } else {
      console.warn('[links] falha ao ler links do Neon — cache vazio nesta sessão, banco intocado.');
    }
  } catch (e) { console.error('[links] init:', e.message); }
  return cache.length;
}

// ── API pública (escopada por conta) ───────────────────────────────────────
function list(accountId) {
  return cache.filter((l) => !accountId || l.acc === accountId).map((l) => ({ ...l }));
}
function get(accountId, slug) {
  const s = slugify(slug);
  return cache.find((l) => l.slug === s && (!accountId ? !l.acc : l.acc === accountId)) || null;
}
// Resolve um /go/:slug público sem atravessar tenants. Quando existe uma
// conta preferida (domínio/host já resolvido), a busca é ESTRITA nessa conta.
// No host compartilhado, slug duplicado entre contas é ambíguo e falha fechado
// em vez de entregar o link da primeira conta que carregou no cache.
function resolve(slug, preferredAccountId) {
  const s = slugify(slug);
  if (!s) return null;
  if (preferredAccountId) {
    return cache.find((l) => l.slug === s && l.acc === preferredAccountId) || null;
  }
  const matches = cache.filter((l) => l.slug === s);
  return matches.length === 1 ? matches[0] : null;
}

async function save(accountId, input) {
  input = input || {};
  const createOnly = input._createOnly === true;
  const originalSlug = slugify(input._originalSlug || input.slug || input.nome);
  let slug = input.slug ? slugify(input.slug) : (createOnly ? '' : originalSlug);
  if (createOnly && !slug) slug = publicSlug.generate();
  const existing = get(accountId, originalSlug || slug);
  const changingPublicAddress = createOnly || (existing && slug !== existing.slug);
  if (changingPublicAddress) {
    const checked = publicSlug.validate(slug);
    if (!checked.ok) {
      const err = new Error(checked.error);
      err.code = checked.code;
      throw err;
    }
    slug = checked.slug;
  }

  const targetExisting = get(accountId, slug);
  delete input._createOnly;
  delete input._originalSlug;

  // Criação explícita nunca vira edição silenciosa; rename também não pode
  // ocupar a slug de outro Link.
  if (createOnly && targetExisting) {
    const err = new Error('Já existe um link com este endereço. Escolha outro endereço.');
    err.code = 'conflict';
    throw err;
  }
  if (existing && slug !== existing.slug && targetExisting) {
    const err = new Error('Este endereço já está sendo usado por outro link.');
    err.code = 'conflict';
    throw err;
  }
  if (!createOnly && input._baseUpdatedAt && existing && existing.updatedAt && input._baseUpdatedAt !== existing.updatedAt) {
    const err = new Error('Este link foi alterado em outra aba ou por outro usuário. Recarregue a página para ver a versão atual antes de salvar.');
    err.code = 'conflict';
    throw err;
  }
  delete input._baseUpdatedAt;

  const merged = normalize(slug, Object.assign({}, existing || {}, input, { slug, acc: accountId }));
  if (!merged.variantes.length) throw new Error('pelo menos 1 variante com URL https:// válida é obrigatória');
  if (existing) {
    merged.criadoEm = existing.criadoEm;
    merged.variantes.forEach((v) => {
      const prev = existing.variantes.find((p) => p.id === v.id);
      if (prev) { v.clicks = prev.clicks; v.conversions = prev.conversions; v.revenue = prev.revenue; }
    });
    if (existing.dominio !== merged.dominio) { merged.dominioValidado = false; merged.dominioValidadoEm = null; }
    else { merged.dominioValidado = existing.dominioValidado; merged.dominioValidadoEm = existing.dominioValidadoEm; }
  }
  if (!merged.dominioValidado && merged.dominio && validatedDomains.has(merged.dominio)) {
    merged.dominioValidado = true;
    merged.dominioValidadoEm = validatedDomains.get(merged.dominio);
  }

  if (db.enabled) {
    const durable = existing && existing.slug !== slug && typeof db.renameLink === 'function'
      ? await db.renameLink(accountId, existing.slug, slug, merged)
      : await db.upsertLink(accountId, slug, merged);
    if (!durable) {
      const err = new Error(existing && existing.slug !== slug
        ? 'Não foi possível alterar o endereço deste link agora. O endereço anterior foi preservado.'
        : 'Não foi possível persistir o link agora. Nenhuma alteração foi aplicada.');
      err.code = 'persistence_failed';
      throw err;
    }
  }
  if (existing && existing.slug !== slug) {
    cache = cache.filter((l) => !(l.slug === existing.slug && l.acc === accountId));
  }
  const idx = cache.findIndex((l) => l.slug === slug && l.acc === accountId);
  if (idx >= 0) cache[idx] = merged; else cache.push(merged);
  return merged;
}

async function remove(accountId, slug) {
  slug = slugify(slug);
  const existing = get(accountId, slug);
  if (!existing) {
    const err = new Error('link não encontrado');
    err.code = 'not_found';
    throw err;
  }
  if (db.enabled) {
    const durable = await db.deleteLink(accountId, slug);
    if (!durable) {
      const err = new Error('Não foi possível remover o link agora. Tente novamente.');
      err.code = 'persistence_failed';
      throw err;
    }
  }
  cache = cache.filter((l) => !(l.slug === slug && l.acc === accountId));
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
const _dirty = new Set(); // 'acc|slug'
let _flushTimer = null;
function persistSoon(link) {
  _dirty.add((link.acc || '') + '|' + link.slug);
  if (_flushTimer) return;
  _flushTimer = setTimeout(() => {
    _flushTimer = null;
    const keys = Array.from(_dirty); _dirty.clear();
    keys.forEach((k) => {
      const [acc, s] = k.split('|');
      const link = cache.find((l) => l.slug === s && (l.acc || '') === acc);
      if (link && db.enabled) db.upsertLink(link.acc || null, s, link);
    });
  }, 1000);
  if (_flushTimer.unref) _flushTimer.unref();
}

function recordClick(accountId, slug, variantId) {
  const link = get(accountId, slug);
  if (!link) return;
  const v = link.variantes.find((x) => x.id === variantId);
  if (!v) return;
  v.clicks = (v.clicks || 0) + 1;
  evaluateExperiment(link);
  persistSoon(link);
}

function recordConversion(accountId, slug, variantId, amountCents, currency) {
  const link = get(accountId, slug);
  if (!link) return;
  const v = link.variantes.find((x) => x.id === variantId) || link.variantes[0];
  if (!v) return;
  v.conversions = (v.conversions || 0) + 1;
  const cur = String(currency || 'eur').toUpperCase();
  v.revenue[cur] = (v.revenue[cur] || 0) + (amountCents || 0);
  evaluateExperiment(link);
  persistSoon(link);
}

function evaluateExperiment(link) {
  if (!link || !link.experiment || !link.experiment.enabled || link.experiment.status === 'concluded') return null;
  const result = abPredictor.evaluate(link.variantes, link.experiment);
  link.experiment.lastEvaluation = Object.assign({ at: new Date().toISOString() }, result);
  if (result.ready && link.experiment.autoStop && result.winnerId) {
    link.variantes.forEach((variant) => { variant.peso = variant.id === result.winnerId ? 100 : 0; });
    link.experiment.status = 'concluded';
    link.experiment.winnerId = result.winnerId;
    link.experiment.concludedAt = new Date().toISOString();
  }
  return result;
}

function experimentResult(accountId, slug) {
  const link = get(accountId, slug);
  if (!link) return null;
  const result = abPredictor.evaluate(link.variantes, link.experiment || {});
  link.experiment.lastEvaluation = Object.assign({ at: new Date().toISOString() }, result);
  persistSoon(link);
  return { experiment: link.experiment, result };
}

// ── Validação de domínio: DNS resolve + resposta HTTP real ────────────────
async function validateDomain(input) {
  const host = hostnameOf(input);
  if (!host || !/\./.test(host)) return { ok: false, error: 'domínio inválido' };
  // 1. DNS: precisa resolver apenas para IPs públicos. Isso impede que a
  // validação seja usada como proxy para localhost/metadata/redes internas.
  let addresses;
  try {
    addresses = await domainSecurity.resolvePublicHost(host);
  } catch (err) {
    return { ok: false, host, dns: false, error: err && err.code === 'unsafe_address' ? 'domínio aponta para rede privada/reservada' : 'domínio não resolve (DNS)' };
  }
  // 2. HTTPS: conexão com o IP já resolvido (pinning anti DNS-rebinding), sem
  // seguir redirects. 2xx/3xx/4xx significam que existe um servidor HTTPS vivo.
  let httpOk = false, status = null;
  for (const method of ['HEAD', 'GET']) {
    try {
      const r = await domainSecurity.httpsProbe(host, '/', { method, addresses, timeoutMs: 8000, maxBytes: 16384 });
      status = r.status;
      if (r.status < 500) { httpOk = true; break; }
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
      persistSoon(l);
    }
  });
  return { ok: true, host, dns: true, http: true, status, validadoEm: now };
}

// Marca um host como validado (ex.: veio verificado da lista global de
// domínios personalizados). Alimenta o mesmo mapa usado pelo save() e aplica
// aos links já existentes que usam esse domínio.
function markDomainValidated(input, iso) {
  const host = hostnameOf(input);
  if (!host) return false;
  const when = iso || new Date().toISOString();
  validatedDomains.set(host, when);
  cache.forEach((l) => {
    if (l.dominio === host && !l.dominioValidado) {
      l.dominioValidado = true;
      l.dominioValidadoEm = when;
      persistSoon(l);
    }
  });
  return true;
}

module.exports = {
  init, list, get, resolve, save, remove, pickVariant,
  recordClick, recordConversion, experimentResult, validateDomain, markDomainValidated, slugify
};
