// ─────────────────────────────────────────────────────────────────────────────
// zernio-ads.js — Cliente da API da Zernio para TikTok Ads (multi-tenant).
//
// A Zernio (https://docs.zernio.com) atua como camada sobre a TikTok
// Business/Marketing API: OAuth, campanhas, ad groups, ads, Spark Ads,
// métricas e Brand Identity — sem onboarding próprio no TikTok for Business.
//
// Modelo de dados da Zernio:
//   Profile      → contêiner de contas sociais (usamos 1 por conta do painel)
//   SocialAccount→ a conta "tiktokads" criada pelo OAuth (accountId)
//   Ad accounts  → advertisers do TikTok enumerados pelo token (adAccountId)
//
// Regras deste módulo:
//   • A chave sk_ NUNCA sai do servidor (o front fala só com /api/ads/*).
//   • Cada conta do painel ganha um profile Zernio próprio (isolamento
//     multi-tenant) — o id fica em config.zernioAds.profileId.
//   • Leituras têm cache em memória com TTL curto (a Zernio já cacheia
//     /ads/accounts por 1h do lado dela; aqui protegemos o polling do painel).
// ─────────────────────────────────────────────────────────────────────────────
const config = require('./config');

const BASE = 'https://zernio.com/api/v1';
const KEY = process.env.ZERNIO_API_KEY || '';

const enabled = /^sk_[0-9a-f]{64}$/i.test(KEY);

// ── HTTP helper ──────────────────────────────────────────────────────────────
// Timeout generoso (45s): criação de anúncio na Zernio faz upload de vídeo
// para o TikTok de forma síncrona e pode demorar.
async function api(method, path, { query, body, timeoutMs, headers } = {}) {
  if (!enabled) {
    const err = new Error('ZERNIO_API_KEY ausente ou inválida no servidor');
    err.status = 503;
    throw err;
  }
  const url = new URL(BASE + path);
  if (query) {
    Object.keys(query).forEach((k) => {
      if (query[k] === undefined || query[k] === null || query[k] === '') return;
      url.searchParams.set(k, String(query[k]));
    });
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 45000);
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: Object.assign(
        { Authorization: 'Bearer ' + KEY },
        body ? { 'Content-Type': 'application/json' } : {},
        headers || {}
      ),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(e.name === 'AbortError' ? 'Zernio: tempo limite excedido' : 'Zernio: falha de rede (' + e.message + ')');
    err.status = 502;
    throw err;
  }
  clearTimeout(timer);
  let data = null;
  try { data = await res.json(); } catch (_) { /* corpo não-JSON */ }
  if (!res.ok && res.status !== 202) {
    // Envelope de erro canônico da Zernio: { error, type, code, param, platform, platformError }
    const err = new Error((data && data.error) || ('Zernio HTTP ' + res.status));
    err.status = res.status;
    err.zernio = data || null;
    throw err;
  }
  // 202 = backfill de métricas em andamento — o corpo já vem com dados parciais
  if (res.status === 202 && data && typeof data === 'object') data.backfillPending = true;
  return data;
}

// ── Profile por conta do painel ──────────────────────────────────────────────
// Cria (uma única vez) um profile Zernio dedicado à conta e persiste o id na
// config. Profiles isolam as contas sociais entre tenants do painel.
const profileLocks = new Map(); // accountId → Promise (evita corrida dupla)

async function ensureProfile(accountId) {
  const cfg = config.get(accountId);
  const saved = (cfg.zernioAds || {}).profileId;
  if (saved) return saved;
  if (profileLocks.has(accountId)) return profileLocks.get(accountId);
  const p = (async () => {
    // nome estável e identificável no painel da Zernio
    const created = await api('POST', '/profiles', {
      body: { name: 'Painel ' + String(accountId).slice(0, 20), description: 'Criado pelo dashboard (TikTok Ads)' }
    });
    const id = created && created.profile && created.profile._id;
    if (!id) throw new Error('Zernio não retornou o id do profile');
    const cur = config.get(accountId);
    config.set(accountId, { zernioAds: Object.assign({}, cur.zernioAds, { profileId: id }) });
    return id;
  })().finally(() => profileLocks.delete(accountId));
  profileLocks.set(accountId, p);
  return p;
}

// ── Estado persistido por conta ──────────────────────────────────────────────
// zernioAds: { profileId, accountId (SocialAccount tiktokads), advertiserId,
//              identity: { identityId, displayName, imageUrl } }
function getState(accountId) {
  return Object.assign({ profileId: '', accountId: '', advertiserId: '', identity: null }, config.get(accountId).zernioAds || {});
}

function setState(accountId, patch) {
  const cur = getState(accountId);
  const next = Object.assign({}, cur, patch || {});
  config.set(accountId, { zernioAds: next });
  return next;
}

// ── Cache de leitura (TTL curto) ─────────────────────────────────────────────
const cache = new Map(); // chave → { at, ttl, data }
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.data;
  cache.delete(key);
  return null;
}
function cacheSet(key, data, ttlMs) {
  cache.set(key, { at: Date.now(), ttl: ttlMs, data });
  // higiene: nunca deixa o mapa crescer sem limite
  if (cache.size > 500) {
    const oldest = [...cache.keys()].slice(0, 100);
    oldest.forEach((k) => cache.delete(k));
  }
}
function cacheBust(prefix) {
  [...cache.keys()].forEach((k) => { if (k.startsWith(prefix)) cache.delete(k); });
}

module.exports = { api, enabled, ensureProfile, getState, setState, cacheGet, cacheSet, cacheBust };
