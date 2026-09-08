// ── Multi-pixel store — POR CONTA (multi-tenant) ──────────────────────────
// Fonte de verdade durável: Neon (tabela pixels, PK `${accountId}:${slug}`).
// Cache quente em memória com TODOS os pixels de TODAS as contas; a API
// filtra por accountId. Cada pixel tem um `token` público próprio que
// alimenta o script individual GET /px/:token.js (instalável em qualquer
// página, estilo Xtracky). O disco (pixels/*.json) é só conveniência local
// de dev — best-effort, nunca fonte de verdade.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');
const redis = require('./redis');

// Diagnóstico de saúde da última gravação — lido pelo painel (/api/pixels/health)
// para mostrar se a config está DURÁVEL (banco/Redis) ou só em memória volátil.
const saveHealth = { lastOk: null, lastError: null, durable: false, at: null };

const DIR = path.join(__dirname, 'pixels');
let cache = [];        // pixels de todas as contas (cada um com .acc)
let byRoute = null;    // memo por conta+rota, invalidado a cada mudança

function ensureDir() {
  try { if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true }); }
  catch (e) { console.error('[pixels] não consegui criar diretório:', e.message); }
}

// slug seguro para nome de arquivo
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || ('pixel-' + Date.now());
}

function newToken() {
  return 'px_' + crypto.randomBytes(16).toString('hex');
}

// Só ASCII imprimível (0x20–0x7E) + trim: credenciais que viram header/URL HTTP
// não podem ter caractere > 255 (o fetch do Node quebra com "ByteString").
function cleanAscii(v) {
  return String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, '').trim();
}

// normaliza um objeto de pixel vindo de arquivo/dashboard/banco
function normalize(slug, raw) {
  raw = raw || {};
  const ev = raw.events || {};
  return {
    slug,
    acc: raw.acc || raw.accountId || null,     // conta dona (multi-tenant)
    token: raw.token || newToken(),            // token público do script /px/:token.js
    name: raw.name || slug,
    // pixelCode/accessToken vão parar em header/URL HTTP → só ASCII imprimível.
    // Remover controle/não-ASCII evita que um caractere corrompido (ex.: "�" de
    // um colar com encoding errado) derrube o disparo da CAPI (ByteString).
    pixelCode: cleanAscii(raw.pixelCode),
    accessToken: cleanAscii(raw.accessToken),
    testEventCode: cleanAscii(raw.testEventCode),
    active: raw.active !== false,
    // filtro de rota aposentado: o pixel vale em TODA página onde o script é colado
    routes: ['*'],
    // ── Vínculo pixel ↔ gateway (isolamento de eventos monetários) ────────
    // Lista de IDs de gateway (gw_…) dos quais este pixel aceita eventos de
    // DINHEIRO (CompletePayment/AddPaymentInfo/Refund/Dispute). Lista vazia é
    // fallback apenas quando o destino já veio da tag/link ou há um único pixel
    // elegível. Com vários pixels, nunca significa "enviar a todos".
    gatewayIds: Array.isArray(raw.gatewayIds)
      ? [...new Set(raw.gatewayIds.map((g) => String(g || '').trim()).filter(Boolean))].slice(0, 50)
      : [],
    gatewayBindingMode: raw.gatewayBindingMode === 'explicit' ? 'explicit' : 'legacy',
    events: {
      ViewContent: ev.ViewContent !== false,
      InitiateCheckout: ev.InitiateCheckout !== false,
      AddPaymentInfo: ev.AddPaymentInfo !== false,
      CompletePayment: ev.CompletePayment !== false,
      // Item 37: default ALINHADO ao editor da dashboard (que cria pixels com
      // AddToCart ligado). Só desliga se o usuário desmarcar explicitamente.
      AddToCart: ev.AddToCart !== false
    },
    updatedAt: raw.updatedAt || new Date().toISOString()
  };
}

function fileFor(acc, slug) {
  return path.join(DIR, (acc ? acc + '--' : '') + slug + '.json');
}

// Escreve o arquivo do pixel no disco — BEST-EFFORT (FS read-only em prod).
function writeFile(acc, slug, cfg) {
  try {
    ensureDir();
    fs.writeFileSync(fileFor(acc, slug), JSON.stringify(cfg, null, 2));
  } catch (e) {
    console.warn('[pixels] disco indisponível (ok em produção):', e.code || e.message);
  }
}

// ── Boot: hidrata TODAS as contas do Neon (fonte de verdade) ──────────────
async function init() {
  // Só o Neon pode afirmar de forma autoritativa que a conta não tem pixels.
  // Antes, uma leitura bem-sucedida com `data: []` caía no snapshot Redis e
  // ressuscitava o último pixel removido quando aquele espelho estava obsoleto.
  let primaryLoaded = false;
  if (db.enabled) {
    try {
      const res = await db.loadPixels(null); // todas as contas
      if (res && res.ok) {
        primaryLoaded = true;
        cache = (res.data || []).map((r) => {
          // r.slug vem limpo do db.js; account vem embutido no data ou no prefixo
          const px = normalize(r.slug, r);
          return px;
        });
        byRoute = null;
        // Garante que todo pixel tenha token (pixels antigos não tinham) —
        // espelha de volta no banco os que ganharam token agora.
        cache.forEach((p) => {
          if (!p.token) { p.token = newToken(); }
        });
        console.log('[pixels] ' + cache.length + ' pixel(s) hidratado(s) do banco.');
      } else {
        console.warn('[pixels] falha ao ler pixels do Neon — tentando snapshot no Redis.');
      }
    } catch (e) { console.error('[pixels] rehydrate:', e.message); }
  }

  // Fallback DURÁVEL: se o banco estiver desligado ou a leitura falhar, hidrata
  // do snapshot no Redis. Isso evita perder toda a config de pixel num restart
  // quando o Neon está indisponível — antes o cache ficava vazio e NENHUM
  // evento era disparado ao TikTok.
  // Uma lista vazia CONFIRMADA pelo Neon não é falha: é o estado autoritativo
  // depois da exclusão do último pixel e nunca deve cair num snapshot antigo.
  if (!primaryLoaded && !cache.length) {
    try {
      const snap = await redis.loadPixelSnapshot();
      if (snap && snap.length) {
        cache = snap.map((r) => normalize(r.slug || slugify(r.name), r));
        byRoute = null;
        console.log('[pixels] ' + cache.length + ' pixel(s) hidratado(s) do snapshot Redis (banco indisponível).');
      }
    } catch (e) { console.error('[pixels] snapshot Redis:', e.message); }
  }

  // Migração do pixel único legado (env) — só sem banco/dados (dev local).
  if (!cache.length && !db.enabled) {
    const legacyCode = process.env.TIKTOK_PIXEL_CODE;
    if (legacyCode) {
      cache = [normalize('default', {
        name: 'Pixel principal',
        pixelCode: legacyCode,
        accessToken: process.env.TIKTOK_ACCESS_TOKEN || '',
        active: true,
        routes: ['*']
      })];
      byRoute = null;
      console.log('[pixels] pixel legado carregado do env (modo sem banco).');
    }
  }

  console.log('[pixels] pronto — ' + cache.length + ' pixel(s) no cache.');
  return cache.length;
}

// ── API pública (todas escopadas por conta) ───────────────────────────────
function list(accountId) {
  return cache.filter((p) => !accountId || p.acc === accountId).map((p) => ({ ...p }));
}

// Pixels ativos de UMA conta que se aplicam a uma rota (path).
function forRoute(accountId, routePath) {
  const p = (routePath || '/').split('?')[0];
  const key = (accountId || '') + '|' + p;
  if (!byRoute) byRoute = new Map();
  if (byRoute.has(key)) return byRoute.get(key);
  const out = cache.filter((px) => {
    if (accountId && px.acc !== accountId) return false;
    if (!accountId && px.acc) return false; // sem conta: só pixels legados
    if (!px.active || !px.pixelCode) return false;
    if (px.routes.indexOf('*') >= 0) return true;
    return px.routes.some((r) => r === p || (r !== '/' && p.indexOf(r) === 0));
  });
  if (byRoute.size < 500) byRoute.set(key, out); // limite defensivo
  return out;
}

// Pixels ativos de uma conta que aceitam um evento específico numa rota.
function forEvent(accountId, eventName, routePath) {
  return forRoute(accountId, routePath).filter((px) => px.events && px.events[eventName]);
}

function get(accountId, slug) {
  return cache.find((p) => p.slug === slug && (!accountId ? !p.acc : p.acc === accountId)) || null;
}

// Busca por token público (para o script individual /px/:token.js).
function getByToken(token) {
  if (!token) return null;
  return cache.find((p) => p.token === token) || null;
}

// Cria/atualiza um pixel: DURABILIDADE PRIMEIRO (Neon e/ou Redis), depois
// memória. Antes o `save` sempre reportava sucesso mesmo que o banco falhasse —
// a config parecia salva, mas sumia no próximo restart e o pixel parava de
// disparar. Agora exigimos confirmação de PELO MENOS uma camada durável e
// registramos o estado em `saveHealth` para o painel avisar o usuário.
async function save(accountId, input) {
  const slug = input.slug ? slugify(input.slug) : slugify(input.name);
  const existing = get(accountId, slug);
  const cfg = normalize(slug, { ...(existing || {}), ...input, slug, acc: accountId });
  cfg.updatedAt = new Date().toISOString();

  let dbOk = false;
  let redisOk = false;
  if (db.enabled) dbOk = await db.upsertPixel(accountId, slug, cfg);   // fonte primária
  // O Neon é autoritativo no boot; não confirmar apenas pelo espelho Redis.
  if (db.enabled && !dbOk) {
    const err = new Error('Não foi possível salvar no banco. O pixel anterior foi preservado.');
    err.code = 'pixel_save_not_durable'; err.status = 503; throw err;
  }
  if (redis.enabled) redisOk = await redis.savePixelSnapshot(accountId, slug, cfg);
  if (!db.enabled && ((redis.enabled && !redisOk) || (!redis.enabled && process.env.NODE_ENV === 'production'))) {
    const err = new Error('Armazenamento indisponível. O pixel não foi alterado.');
    err.code = 'pixel_save_not_durable'; err.status = 503; throw err;
  }

  const durable = dbOk || redisOk;
  saveHealth.durable = durable;
  saveHealth.at = cfg.updatedAt;
  if (durable) {
    saveHealth.lastOk = cfg.updatedAt;
    saveHealth.lastError = null;
  } else {
    // Nenhuma camada durável confirmou. Ainda atualizamos a memória para não
    // travar a sessão atual, mas avisamos claramente que a config é volátil.
    saveHealth.lastError = db.enabled || redis.enabled
      ? 'Falha ao gravar no armazenamento durável — config só em memória (some ao reiniciar).'
      : 'Sem banco nem Redis configurados — config só em memória (some ao reiniciar).';
    console.error('[pixels] SAVE NÃO DURÁVEL:', saveHealth.lastError, '(' + slug + ')');
  }

  const idx = cache.findIndex((p) => p.slug === slug && p.acc === accountId);
  if (idx >= 0) cache[idx] = cfg; else cache.push(cfg);
  byRoute = null;
  writeFile(accountId, slug, cfg);                              // local, pode falhar
  return { ...get(accountId, slug), _durable: durable, _saveError: saveHealth.lastError };
}

// Estado da última gravação — consumido pelo painel para exibir o aviso de
// "config não durável" (item 51/53).
function health() {
  return {
    ...saveHealth,
    dbEnabled: !!db.enabled,
    redisEnabled: !!redis.enabled,
    count: cache.length
  };
}

async function remove(accountId, slug) {
  slug = slugify(slug);
  const existing = get(accountId, slug);

  // Confirma TODAS as camadas duráveis configuradas antes de alterar o cache.
  // Ignorar um `false` aqui fazia a API responder sucesso, mas o registro que
  // ficou no Neon/Redis reaparecia no próximo boot. O espelho Redis é apagado
  // primeiro; se o Neon falhar em seguida, restauramos o snapshot a partir do
  // cache para manter a operação repetível e sem estado parcialmente removido.
  if (redis.enabled && !(await redis.deletePixelSnapshot(accountId, slug))) {
    const err = new Error('Não foi possível confirmar a remoção no armazenamento durável: Redis.');
    err.code = 'pixel_delete_not_durable';
    err.status = 503;
    err.hint = 'O pixel foi preservado. Tente novamente quando o armazenamento estiver disponível.';
    throw err;
  }
  if (db.enabled && !(await db.deletePixel(accountId, slug))) {
    if (redis.enabled && existing) await redis.savePixelSnapshot(accountId, slug, existing);
    const err = new Error('Não foi possível confirmar a remoção no armazenamento durável: Neon.');
    err.code = 'pixel_delete_not_durable';
    err.status = 503;
    err.hint = 'O pixel foi preservado. Tente novamente quando o armazenamento estiver disponível.';
    throw err;
  }

  cache = cache.filter((p) => !(p.slug === slug && p.acc === accountId));
  byRoute = null;
  try { if (fs.existsSync(fileFor(accountId, slug))) fs.unlinkSync(fileFor(accountId, slug)); }
  catch (e) { console.warn('[pixels] remove (disco):', e.message); }
  return true;
}

module.exports = {
  init, list, forRoute, forEvent, get, getByToken, save, remove, slugify, health, DIR
};
