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

const PIXEL_EVENT_KEYS = ['ViewContent', 'InitiateCheckout', 'AddPaymentInfo', 'CompletePayment', 'AddToCart'];

function nextRevision(previous) {
  const prevMs = Date.parse(String(previous || ''));
  const now = Date.now();
  return new Date(Number.isFinite(prevMs) && now <= prevMs ? prevMs + 1 : now).toISOString();
}

function mutationError(code, message, status, hint, currentUpdatedAt) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.hint = hint;
  if (currentUpdatedAt) err.currentUpdatedAt = currentUpdatedAt;
  return err;
}

// Patch top-level seguro para UPDATE atômico. Campos ausentes simplesmente não
// entram no JSONB merge do Postgres; assim toggle/vínculo não reenviam nem
// restauram credencial/eventos a partir de um cache potencialmente antigo.
function normalizePatch(input) {
  const raw = input || {};
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(raw, 'name')) patch.name = String(raw.name || '').trim();
  if (Object.prototype.hasOwnProperty.call(raw, 'pixelCode')) patch.pixelCode = cleanAscii(raw.pixelCode);
  if (Object.prototype.hasOwnProperty.call(raw, 'accessToken')) patch.accessToken = cleanAscii(raw.accessToken);
  if (Object.prototype.hasOwnProperty.call(raw, 'testEventCode')) patch.testEventCode = cleanAscii(raw.testEventCode);
  if (Object.prototype.hasOwnProperty.call(raw, 'active')) patch.active = raw.active !== false;
  if (Object.prototype.hasOwnProperty.call(raw, 'gatewayIds')) {
    patch.gatewayIds = Array.isArray(raw.gatewayIds)
      ? [...new Set(raw.gatewayIds.map((g) => String(g || '').trim()).filter(Boolean))].slice(0, 50)
      : [];
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'gatewayBindingMode')) {
    patch.gatewayBindingMode = raw.gatewayBindingMode === 'explicit' ? 'explicit' : 'legacy';
  }
  if (Object.prototype.hasOwnProperty.call(raw, 'events')) {
    const ev = raw.events || {};
    const complete = PIXEL_EVENT_KEYS.every((key) => typeof ev[key] === 'boolean');
    if (!complete) throw mutationError('pixel_events_invalid', 'A configuração de eventos do Pixel está incompleta.', 400,
      'Atualize a tela e salve novamente todos os eventos do Pixel.');
    patch.events = Object.fromEntries(PIXEL_EVENT_KEYS.map((key) => [key, ev[key]]));
  }
  return patch;
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

// Cria/atualiza um pixel: commit no Neon é a autoridade. CREATE e UPDATE
// possuem contratos diferentes e UPDATE usa compare-and-swap durável. O cache
// só muda DEPOIS que a persistência vencedora foi confirmada.
async function save(accountId, input, options) {
  const opts = options || {};
  const createOnly = opts.createOnly === true;
  const expectedUpdatedAt = opts.expectedUpdatedAt ? String(opts.expectedUpdatedAt) : '';
  const requestedSlug = input && input.slug ? slugify(input.slug) : slugify(input && input.name);
  const cached = get(accountId, requestedSlug);
  const creating = createOnly || (!input.slug && !cached);

  let committed;
  let revision;
  let dbOk = false;
  let redisOk = false;

  if (creating) {
    if (!db.enabled && cached) throw mutationError('pixel_create_conflict', 'Já existe um Pixel com este identificador.', 409,
      'Atualize a lista ou escolha outro nome antes de criar novamente.', cached.updatedAt);
    revision = nextRevision(null);
    const cfg = normalize(requestedSlug, {
      ...(input || {}),
      slug: requestedSlug,
      acc: accountId,
      // Configurações criadas pelo produto atual têm intenção explícita de
      // roteamento, inclusive quando a lista de checkouts está vazia.
      gatewayBindingMode: input && input.gatewayBindingMode === 'legacy' ? 'legacy' : 'explicit',
      updatedAt: revision,
    });
    cfg.updatedAt = revision;

    if (!db.enabled && cfg.pixelCode) {
      const duplicate = cache.find((p) => p.acc === accountId && p.pixelCode === cfg.pixelCode && p.slug !== requestedSlug);
      if (duplicate) throw mutationError('duplicate_pixel_code', 'Este Pixel Code já está cadastrado nesta conta.', 409,
        'Edite o Pixel existente ou use outro Pixel Code.');
    }

    if (db.enabled) {
      const result = await db.createPixel(accountId, requestedSlug, cfg);
      if (!result || !result.ok) {
        if (result && result.conflict === 'slug') throw mutationError('pixel_create_conflict',
          'Já existe um Pixel com este identificador.', 409,
          'Atualize a lista ou escolha outro nome antes de criar novamente.');
        if (result && result.conflict === 'pixel_code') throw mutationError('duplicate_pixel_code',
          'Este Pixel Code já está cadastrado nesta conta.', 409,
          'Edite o Pixel existente ou use outro Pixel Code.');
        throw mutationError('pixel_save_not_durable', 'Não foi possível salvar no banco. Nenhuma alteração foi aplicada.', 503,
          'Tente novamente quando o armazenamento estiver disponível.');
      }
      dbOk = true;
      committed = normalize(requestedSlug, { ...(result.data || cfg), acc: accountId });
    } else {
      committed = cfg;
    }
  } else {
    if (!input || !input.slug) throw mutationError('pixel_slug_required', 'O Pixel a editar não foi identificado.', 400);
    if (!expectedUpdatedAt) throw mutationError('pixel_revision_required',
      'A edição precisa informar a revisão do Pixel que foi aberta.', 409,
      'Atualize a lista e tente novamente para evitar sobrescrever uma alteração mais recente.');
    if (!db.enabled && cached && cached.updatedAt && String(cached.updatedAt) !== expectedUpdatedAt) {
      throw mutationError('pixel_revision_conflict', 'Este Pixel foi alterado em outra aba ou por outro usuário.', 409,
        'Atualize a lista, confira a versão atual e tente novamente.', cached.updatedAt);
    }
    const patch = normalizePatch(input);
    revision = nextRevision(expectedUpdatedAt);

    if (!db.enabled && patch.pixelCode) {
      const duplicate = cache.find((p) => p.acc === accountId && p.pixelCode === patch.pixelCode && p.slug !== requestedSlug);
      if (duplicate) throw mutationError('duplicate_pixel_code', 'Este Pixel Code já está cadastrado nesta conta.', 409,
        'Edite o Pixel existente ou use outro Pixel Code.');
    }

    if (db.enabled) {
      const result = await db.updatePixelVersioned(accountId, requestedSlug, patch, expectedUpdatedAt, revision);
      if (!result || !result.ok) {
        if (result && result.conflict === 'pixel_code') throw mutationError('duplicate_pixel_code',
          'Este Pixel Code já está cadastrado nesta conta.', 409,
          'Edite o Pixel existente ou use outro Pixel Code.');
        if (result && result.conflict === 'revision') {
          if (result.current) {
            const latest = normalize(requestedSlug, { ...result.current, acc: accountId });
            const idx = cache.findIndex((p) => p.slug === requestedSlug && p.acc === accountId);
            if (idx >= 0) cache[idx] = latest; else cache.push(latest);
            byRoute = null;
          }
          throw mutationError('pixel_revision_conflict', 'Este Pixel foi alterado em outra aba ou por outro usuário.', 409,
            'Atualize a lista, confira a versão atual e tente novamente.', result.currentUpdatedAt);
        }
        throw mutationError('pixel_save_not_durable', 'Não foi possível salvar no banco. O Pixel anterior foi preservado.', 503,
          'Tente novamente quando o armazenamento estiver disponível.');
      }
      dbOk = true;
      committed = normalize(requestedSlug, { ...(result.data || {}), acc: accountId });
    } else {
      if (!cached) throw mutationError('pixel_not_found', 'Pixel não encontrado.', 404, 'Atualize a lista e tente novamente.');
      committed = normalize(requestedSlug, { ...cached, ...patch, acc: accountId, updatedAt: revision });
      committed.updatedAt = revision;
    }
  }

  // O Neon é a fonte primária. Em dev sem Neon, o Redis pode ser a única
  // camada durável. O espelho só recebe a versão já vencedora.
  if (redis.enabled) redisOk = await redis.savePixelSnapshot(accountId, requestedSlug, committed);
  if (!db.enabled && ((redis.enabled && !redisOk) || (!redis.enabled && process.env.NODE_ENV === 'production'))) {
    throw mutationError('pixel_save_not_durable', 'Armazenamento indisponível. O Pixel não foi alterado.', 503,
      'Tente novamente quando o armazenamento estiver disponível.');
  }

  const durable = dbOk || redisOk;
  saveHealth.durable = durable;
  saveHealth.at = committed.updatedAt;
  if (durable) {
    saveHealth.lastOk = committed.updatedAt;
    saveHealth.lastError = null;
  } else {
    saveHealth.lastError = db.enabled || redis.enabled
      ? 'Falha ao gravar no armazenamento durável — config só em memória (some ao reiniciar).'
      : 'Sem banco nem Redis configurados — config só em memória (some ao reiniciar).';
    console.error('[pixels] SAVE NÃO DURÁVEL:', saveHealth.lastError, '(' + requestedSlug + ')');
  }

  const idx = cache.findIndex((p) => p.slug === requestedSlug && p.acc === accountId);
  if (idx >= 0) cache[idx] = committed; else cache.push(committed);
  byRoute = null;
  writeFile(accountId, requestedSlug, committed);
  return { ...get(accountId, requestedSlug), _durable: durable, _saveError: saveHealth.lastError };
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

async function remove(accountId, slug, options) {
  slug = slugify(slug);
  const expectedUpdatedAt = options && options.expectedUpdatedAt ? String(options.expectedUpdatedAt) : '';
  let existing = get(accountId, slug);
  if (!existing && db.enabled && typeof db.loadPixel === 'function') {
    const durable = await db.loadPixel(accountId, slug);
    if (durable) existing = normalize(slug, { ...durable, acc: accountId });
  }
  if (!existing) throw mutationError('pixel_not_found', 'Pixel não encontrado.', 404,
    'Atualize a lista: ele pode já ter sido removido em outra aba.');
  if (!expectedUpdatedAt) throw mutationError('pixel_revision_required',
    'A exclusão precisa informar a revisão do Pixel que foi confirmada pelo usuário.', 409,
    'Atualize a lista e tente novamente.');
  if (!db.enabled && existing.updatedAt && String(existing.updatedAt) !== expectedUpdatedAt) {
    throw mutationError('pixel_revision_conflict', 'Este Pixel foi alterado depois que a exclusão foi aberta.', 409,
      'Atualize a lista e confira a versão atual antes de excluir.', existing.updatedAt);
  }

  // Mantém a política atual: o espelho é removido primeiro e restaurado se o
  // commit primário não puder ser confirmado. A mudança desta leva é o CAS no
  // delete do Neon, para uma revisão antiga nunca remover uma configuração nova.
  if (redis.enabled && !(await redis.deletePixelSnapshot(accountId, slug))) {
    throw mutationError('pixel_delete_not_durable',
      'Não foi possível confirmar a remoção no armazenamento durável: Redis.', 503,
      'O Pixel foi preservado. Tente novamente quando o armazenamento estiver disponível.');
  }
  if (db.enabled) {
    const result = await db.deletePixelVersioned(accountId, slug, expectedUpdatedAt);
    if (!result || !result.ok) {
      if (redis.enabled) {
        const restore = result && result.current
          ? normalize(slug, { ...result.current, acc: accountId })
          : existing;
        await redis.savePixelSnapshot(accountId, slug, restore);
      }
      if (result && result.conflict === 'revision') {
        if (result.current) {
          const latest = normalize(slug, { ...result.current, acc: accountId });
          const idx = cache.findIndex((p) => p.slug === slug && p.acc === accountId);
          if (idx >= 0) cache[idx] = latest;
          byRoute = null;
        }
        throw mutationError('pixel_revision_conflict', 'Este Pixel foi alterado depois que a exclusão foi aberta.', 409,
          'Atualize a lista e confira a versão atual antes de excluir.', result.currentUpdatedAt);
      }
      throw mutationError('pixel_delete_not_durable',
        'Não foi possível confirmar a remoção no armazenamento durável: Neon.', 503,
        'O Pixel foi preservado. Tente novamente quando o armazenamento estiver disponível.');
    }
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
