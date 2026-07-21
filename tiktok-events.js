// ── TikTok Events API v1.3 — rastreamento server-side (CAPI) ──────────────
// Dispara eventos direto do servidor para MÚLTIPLOS pixels (um por arquivo em
// pixels/*.json). Deduplica com o pixel do navegador via event_id idêntico.
const crypto = require('crypto');
const pixelStore = require('./pixel-store');
const db  = require('./db');
const rdb = require('./redis');
const { traduzErroTikTok } = require('./tiktok-errors');

const TIKTOK_API_URL = 'https://business-api.tiktok.com/open_api/v1.3/event/track/';

// Eventos MONETÁRIOS: só disparam com confirmação do gateway (p._trusted).
// Client-side fica restrito a ViewContent / InitiateCheckout / AddToCart.
// Refund/Dispute entram aqui para o dia em que os providers os enviarem.
const MONEY_EVENTS = new Set(['CompletePayment', 'AddPaymentInfo', 'Refund', 'Dispute']);

// SHA-256 exigido pelo TikTok para todos os dados de identidade (PII)
function hash(value) {
  if (!value) return undefined;
  return crypto.createHash('sha256').update(String(value).trim().toLowerCase()).digest('hex');
}

// Telefone: normaliza para E.164 (+DDDN…) antes do hash, como o TikTok exige.
// "00" internacional vira "+", e o "+" só é mantido no início.
function hashPhone(phone) {
  if (!phone) return undefined;
  let clean = String(phone).replace(/[^0-9+]/g, '');
  if (clean.startsWith('00')) clean = '+' + clean.slice(2);
  clean = clean[0] === '+' ? '+' + clean.slice(1).replace(/\+/g, '') : clean.replace(/\+/g, '');
  const digits = clean.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return undefined; // fora do E.164 → não envia lixo
  return hash(clean);
}

// external_id do lead: hash do v_id (id único salvo no banco). Amarra o funil
// inteiro à mesma pessoa dentro do gerenciador do TikTok.
function externalIdFromLead(vId) {
  return vId ? hash('lead:' + vId) : undefined;
}

// ── Log de disparos em memória (feed rápido do painel) ────────────────────
const LOG_MAX = 200;
const log = [];
const scopedDedup = new Map();
function pushLog(entry) {
  const row = {
    id: crypto.randomBytes(8).toString('hex'),
    at: new Date().toISOString(),
    acc: entry.acc || null,                              // conta dona (multi-tenant)
    pixel: entry.pixel,
    event: entry.event,
    eventId: entry.eventId,
    leadId: entry.leadId,
    status: entry.status,
    emq: entry.emq != null ? entry.emq : null,          // score 0–10 de identidade
    emqFields: entry.emqFields || [],                    // sinais enviados (email, ttclid…)
    response: entry.response
  };
  log.unshift(row);
  if (log.length > LOG_MAX) log.length = LOG_MAX;
  // Upstash Redis: write rápido (~1ms), TTL automático de 14 dias
  rdb.pushPixelLog(row).catch(() => {});
  // Rollup de EMQ por pixel/dia — só disparos REAIS (ok/erro têm score de
  // identidade calculado); ignora linhas de controle ('bloqueado'/'dispatch').
  if (row.emq != null && (row.status === 'ok' || row.status === 'erro')) {
    rdb.bumpEmq(row.acc, row.pixel, row.emq).catch(() => {});
  }
  // Neon: backup durável (estruturado para queries analíticas)
  if (db.enabled) db.insertPixelEvent(row.acc, row);
  return row;
}
function recentLog(n, accountId) {
  const rows = accountId ? log.filter((r) => r.acc === accountId) : log;
  return rows.slice(0, n || 50);
}

// Item 200: limpeza manual do log de disparos POR CONTA (memória + Redis).
// Linhas de outras contas são preservadas — fronteira multi-tenant.
async function clearLog(accountId) {
  let removed = 0;
  for (let i = log.length - 1; i >= 0; i--) {
    if (log[i].acc === accountId || (!log[i].acc && accountId == null)) { log.splice(i, 1); removed++; }
  }
  const fromRedis = await rdb.clearPixelLog(accountId).catch(() => 0);
  return Math.max(removed, fromRedis || 0);
}

// Versão async: usa Redis como fallback se memória local estiver vazia
async function recentLogAsync(n, accountId) {
  let rows = accountId ? log.filter((r) => r.acc === accountId) : log.slice();
  if (!rows.length) {
    // após restart: busca do Redis e re-popula memória local
    const redisRows = await rdb.loadPixelLog(200);
    if (redisRows && redisRows.length) {
      // Evita duplicar linhas que já chegaram de outra conta na memória.
      const known = new Set(log.map((r) => r.id));
      for (const row of redisRows.slice(0, LOG_MAX)) {
        if (!known.has(row.id)) log.push(row);
      }
      if (log.length > LOG_MAX) log.length = LOG_MAX;
      rows = accountId ? log.filter((r) => r.acc === accountId) : log.slice();
    }
  }
  return rows.slice(0, n || 100);
}

// Guards de qualidade: cada campo só entra no payload se for PERFEITO —
// campo ruim derruba o Event Match Quality inteiro do evento no TikTok.
const SHA256_RE = /^[a-f0-9]{64}$/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_RE = /^[0-9a-fA-F:]+$/;
const CUR_RE = /^[A-Z]{3}$/;

// Descarta lixo comum vindo de query/localStorage: "null", "undefined", "", "0"
function cleanStr(v, max) {
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s || s === 'null' || s === 'undefined' || s === 'NaN') return undefined;
  return s.slice(0, max || 500);
}

function validIp(v) {
  const s = cleanStr(v, 45);
  if (!s) return undefined;
  if (IPV4_RE.test(s)) {
    return s.split('.').every((o) => Number(o) <= 255) ? s : undefined;
  }
  return s.includes(':') && IPV6_RE.test(s) ? s : undefined; // IPv6
}

// URL precisa ser absoluta e válida — truncar no meio de um param quebraria
function validUrl(v) {
  const s = cleanStr(v, 2000);
  if (!s) return undefined;
  try { const u = new URL(s); return (u.protocol === 'http:' || u.protocol === 'https:') ? s : undefined; }
  catch (_) { return undefined; }
}

// Monta o objeto `user` (identidade) a partir do payload comum.
function buildUser(p) {
  const user = {};
  const e = hash(cleanStr(p.email, 320));            if (e) user.email = e;
  const ph = hashPhone(cleanStr(p.phone, 30));       if (ph) user.phone = ph;
  const exRaw = cleanStr(p.externalId, 200) || externalIdFromLead(cleanStr(p.leadId, 200));
  // aceita apenas hex SHA-256 como "já-hasheado"; qualquer outra coisa é hasheada
  if (exRaw) user.external_id = SHA256_RE.test(exRaw) ? exRaw : hash(exRaw);
  const ip = validIp(p.ip);                          if (ip) user.ip = ip;
  const ua = cleanStr(p.userAgent, 500);             if (ua) user.user_agent = ua;
  const tc = cleanStr(p.ttclid, 500);                if (tc) user.ttclid = tc;
  const tp = cleanStr(p.ttp, 500);                   if (tp) user.ttp = tp;
  return user;
}

// Score de correspondência (proxy do Event Match Quality do TikTok):
// pesa os sinais de identidade que REALMENTE entraram no payload.
// ttclid é o sinal mais forte (clique atribuível), depois email/phone (PII).
const MATCH_WEIGHTS = { ttclid: 3, email: 2, phone: 2, external_id: 1, ttp: 1, ip: 0.5, user_agent: 0.5 };
const MATCH_MAX = Object.values(MATCH_WEIGHTS).reduce((a, b) => a + b, 0); // 10
function matchScore(user) {
  let score = 0;
  const fields = [];
  Object.keys(MATCH_WEIGHTS).forEach((k) => {
    if (user[k]) { score += MATCH_WEIGHTS[k]; fields.push(k); }
  });
  return { score: Math.round((score / MATCH_MAX) * 10), fields }; // 0–10
}

function buildProperties(p) {
  const properties = {};
  // NaN e Infinity passam em `typeof === 'number'` — Number.isFinite não
  const v = Number(p.value);
  if (p.value != null && Number.isFinite(v) && v >= 0) {
    properties.value = Math.round(v * 100) / 100; // 2 casas: TikTok espera moeda
    const cur = String(p.currency || '').toUpperCase();
    // Fallback configurável por conta (p.fallbackCurrency vem da config da
    // conta via caller); último recurso é BRL — value sem currency é rejeitado
    const fb = String(p.fallbackCurrency || '').toUpperCase();
    properties.currency = CUR_RE.test(cur) ? cur : (CUR_RE.test(fb) ? fb : 'BRL');
  }
  if (Array.isArray(p.contents) && p.contents.length) {
    // sanitiza cada item: só campos válidos, com tipos certos
    const items = p.contents.map((c) => {
      const it = {};
      const cid = cleanStr(c.content_id, 100);       if (cid) it.content_id = cid;
      const cname = cleanStr(c.content_name, 100);   if (cname) it.content_name = cname;
      const ccat = cleanStr(c.content_category, 100); if (ccat) it.content_category = ccat;
      const price = Number(c.price);
      if (c.price != null && Number.isFinite(price) && price >= 0) it.price = Math.round(price * 100) / 100;
      const qty = Number(c.quantity);
      it.quantity = Number.isFinite(qty) && qty >= 1 ? Math.round(qty) : 1;
      return it;
    }).filter((it) => it.content_id || it.content_name);
    if (items.length) { properties.contents = items; properties.content_type = 'product'; }
  }
  return properties;
}

// event_time: TikTok rejeita timestamps no futuro ou com mais de 7 dias.
// Clamp para "agora" em vez de perder o evento inteiro por um relógio torto.
function validEventTime(t) {
  const now = Math.floor(Date.now() / 1000);
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0) return now;
  const sec = n > 1e12 ? Math.floor(n / 1000) : Math.floor(n); // aceita ms por engano
  if (sec > now + 60 || sec < now - 7 * 86400) return now;
  return sec;
}

// fetch com timeout: a API do TikTok nunca pode pendurar um webhook/checkout.
function fetchWithTimeout(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 6000);
  return fetch(url, { ...opts, signal: ctl.signal }).finally(() => clearTimeout(t));
}

// ── Fila de retry persistente ──────────────────────────────────────────────
// Se o TikTok falhar mesmo após os retries imediatos (instabilidade longa,
// restart no meio do disparo), o evento entra aqui e é re-tentado com
// backoff crescente por até 24h. Nenhuma venda fica sem CompletePayment.
const RETRY_BACKOFF_MS = [2 * 60e3, 10 * 60e3, 30 * 60e3, 2 * 3600e3, 6 * 3600e3]; // 2m→6h
const RETRY_MAX_AGE_MS = 24 * 3600e3;
const RETRY_QUEUE_CAP = 300;
let retryQueue = [];
let retryLoaded = false;

function persistRetryQueue() { rdb.saveCapiRetryQueue(retryQueue).catch(() => {}); }

async function ensureRetryLoaded() {
  if (retryLoaded) return;
  retryLoaded = true;
  const saved = await rdb.loadCapiRetryQueue();
  if (saved && saved.length) retryQueue = saved.concat(retryQueue).slice(0, RETRY_QUEUE_CAP);
}

function queueRetry(pixel, p, eventId) {
  // payload mínimo e serializável (sem funções, sem objetos circulares)
  const item = {
    // token é globalmente único → re-resolução não depende da conta.
    // slug + acc ficam como fallback para itens/pixels legados.
    token: pixel.token || null,
    acc: pixel.acc || pixel.accountId || null,
    slug: pixel.slug || pixel.pixelCode,
    eventId,
    p: {
      event: p.event, eventId, leadId: p.leadId, email: p.email, phone: p.phone,
      externalId: p.externalId, ip: p.ip, userAgent: p.userAgent, ttclid: p.ttclid,
      ttp: p.ttp, url: p.url, value: p.value, currency: p.currency,
      contents: p.contents, eventTime: p.eventTime || Math.floor(Date.now() / 1000)
    },
    attempt: 0,
    firstAt: Date.now(),
    nextAt: Date.now() + RETRY_BACKOFF_MS[0]
  };
  retryQueue.push(item);
  if (retryQueue.length > RETRY_QUEUE_CAP) retryQueue = retryQueue.slice(-RETRY_QUEUE_CAP);
  persistRetryQueue();
}

// Re-resolve o pixel de um item da fila sem depender do escopo de conta.
// token é único globalmente; se faltar (item/pixel legado), tenta (acc, slug)
// e por fim uma varredura por slug em todas as contas.
function resolvePixelForRetry(item) {
  if (item.token) {
    const byTok = pixelStore.getByToken(item.token);
    if (byTok) return byTok;
  }
  if (item.slug) {
    const byAcc = pixelStore.get(item.acc || null, item.slug);
    if (byAcc) return byAcc;
    const all = pixelStore.list(null).filter((p) => p.slug === item.slug);
    if (all.length === 1) return all[0]; // slug único entre as contas → seguro
  }
  return null;
}

// opts.force (item 194/198): ignora o backoff e tenta AGORA todos os itens
// (opcionalmente só os de uma conta via opts.acc). Retorna quantos foram
// processados — usado pela ação manual de "forçar drenagem" na dashboard.
async function drainRetryQueue(opts) {
  const force = !!(opts && opts.force);
  const onlyAcc = opts && opts.acc ? opts.acc : null;
  await ensureRetryLoaded();
  if (!retryQueue.length) return 0;
  const now = Date.now();
  let due = retryQueue.filter((it) => force || it.nextAt <= now);
  if (onlyAcc) due = due.filter((it) => (it.acc || null) === onlyAcc);
  if (!due.length) return 0;
  // Lock distribuído: com várias instâncias, todas carregam o MESMO snapshot
  // do Redis e drenariam em paralelo → o mesmo evento seria disparado N vezes.
  // Só a instância que adquire o lock drena neste ciclo (as demais esperam 60s).
  if (!(await rdb.acquireLock('capiRetryDrain', 55))) return 0;
  let processed = 0;
  try {
  for (const item of due) {
    // expirou (24h) ou esgotou o backoff → descarta de vez
    if (now - item.firstAt > RETRY_MAX_AGE_MS || item.attempt >= RETRY_BACKOFF_MS.length) {
      retryQueue = retryQueue.filter((x) => x !== item);
      continue;
    }
    // re-resolve o pixel: token/config podem ter mudado no painel.
    // Ordem: token (globalmente único) → get(acc, slug) → varredura por slug (legado).
    const pixel = resolvePixelForRetry(item);
    if (!pixel || !pixel.active) { retryQueue = retryQueue.filter((x) => x !== item); continue; }
    const json = await sendToPixel(pixel, { ...item.p, _fromRetryQueue: true });
    processed++;
    if (json && json.code === 0) {
      retryQueue = retryQueue.filter((x) => x !== item);          // sucesso
    } else if (json && json.code != null && json.code !== 0) {
      retryQueue = retryQueue.filter((x) => x !== item);          // 4xx: rejeição definitiva
    } else {
      item.attempt += 1;                                          // rede/5xx: reagenda
      item.nextAt = now + (RETRY_BACKOFF_MS[item.attempt] || RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1]);
    }
  }
  persistRetryQueue();
  } finally {
    rdb.releaseLock('capiRetryDrain').catch(() => {});
  }
  return processed;
}

// varre a cada 60s; unref() para não segurar o processo vivo no shutdown
const retryTimer = setInterval(() => { drainRetryQueue().catch(() => {}); }, 60e3);
if (retryTimer.unref) retryTimer.unref();

function retryQueueSize() { return retryQueue.length; }

// Item 193: resumo da fila de retry para a UI (por conta ou global).
// count = quantos eventos aguardam reenvio; oldestAgeMs = idade do mais antigo.
function retryQueueInfo(acc) {
  const list = acc ? retryQueue.filter((it) => (it.acc || null) === acc) : retryQueue;
  if (!list.length) return { count: 0, oldestAgeMs: 0 };
  let oldest = 0;
  for (const it of list) {
    const at = it.firstAt || 0;
    if (at && (!oldest || at < oldest)) oldest = at;
  }
  return { count: list.length, oldestAgeMs: oldest ? Math.max(0, Date.now() - oldest) : 0 };
}

/**
 * Envia UM evento para UM pixel específico.
 * Timeout de 6s por tentativa + 1 retry automático em falha transitória
 * (erro de rede/timeout/5xx) — o evento mais valioso (CompletePayment)
 * não pode se perder por um soluço de rede.
 * @param {object} pixel  Objeto do pixel-store (pixelCode, accessToken, testEventCode)
 * @param {object} p      Payload do evento (event, eventId, identidade, valor…)
 */
// TikTok Access Tokens são ASCII imprimível. Remove qualquer caractere fora de
// 0x20–0x7E (controle, não-ASCII, o "�"/0xFFFD de um token corrompido) para que
// nunca crashe o header HTTP. Trim nas pontas.
function headerSafeToken(v) {
  return String(v == null ? '' : v).replace(/[^\x20-\x7E]/g, '').trim();
}

async function sendToPixel(pixel, p) {
  if (!pixel || !pixel.pixelCode || !pixel.accessToken) {
    // Antes o skip era SILENCIOSO: uma credencial faltando virava no-op invisível
    // e o usuário jamais via por que o evento "não foi". Agora registra no log do
    // painel exatamente o que faltou (item 55).
    const missing = [!pixel || !pixel.pixelCode ? 'pixelCode' : null,
                     !pixel || !pixel.accessToken ? 'accessToken' : null].filter(Boolean);
    pushLog({
      acc: (pixel && pixel.acc) || null,
      pixel: (pixel && (pixel.slug || pixel.pixelCode)) || 'desconhecido',
      event: p && p.event,
      eventId: p && p.eventId,
      leadId: p && p.leadId,
      status: 'ignorado',
      response: { message: 'config incompleta — faltando: ' + (missing.join(', ') || 'credenciais') }
    });
    return {
      skipped: true, reason: 'pixel sem código/token', missing,
      pixel: (pixel && (pixel.slug || pixel.pixelCode)) || 'desconhecido',
      pixelName: (pixel && (pixel.name || pixel.slug)) || 'desconhecido',
    };
  }
  // Identidade do pixel nos RETORNOS (aditivo): o recibo da conversão precisa
  // dizer QUAL pixel falhou e por quê — sem isso o operador vê "erro em 1/2" no
  // feed de Gateways e tem de caçar o motivo no log da aba Pixels.
  const pixelId = pixel.slug || pixel.pixelCode;
  const pixelName = pixel.name || pixel.slug || pixel.pixelCode;
  // event_id é obrigatório para dedup — gera fallback se faltar
  const eventId = p.eventId || (p.event + '.' + crypto.randomBytes(8).toString('hex'));

  // Access-Token como header HTTP: o fetch do Node exige Latin-1. Um token com
  // caractere corrompido (ex.: 0xFFFD, o "�" de um cadastro com encoding errado)
  // faz o fetch lançar "Cannot convert argument to a ByteString" e DERRUBA todo
  // disparo — re-enfileirando para sempre (a fila só cresce). Removemos o que não
  // for ASCII imprimível: recupera tokens com um caractere solto e nunca crasha.
  const accessToken = headerSafeToken(pixel.accessToken);
  if (!accessToken) {
    // Token só tinha lixo → NUNCA autentica: falha determinística. Loga claro e
    // NÃO re-enfileira (senão a fila cresce eternamente batendo no mesmo erro).
    pushLog({
      acc: pixel.acc || null, pixel: pixelId, event: p.event, eventId, leadId: p.leadId,
      status: 'erro',
      response: { message: 'Access Token inválido (caractere corrompido) — reinsira o token do pixel em Conversões › Pixels' },
    });
    return { error: 'Access Token inválido (caractere corrompido) — reinsira o token do pixel', code: 'BAD_TOKEN', pixel: pixelId, pixelName };
  }

  const pageUrl = validUrl(p.url);
  const user = buildUser(p);
  const emq = matchScore(user);
  const payload = {
    event_source: 'web',
    event_source_id: pixel.pixelCode,
    data: [{
      event: p.event,
      event_time: validEventTime(p.eventTime),
      event_id: eventId,
      user,
      properties: buildProperties(p),
      page: pageUrl ? { url: pageUrl } : undefined
    }]
  };
  if (pixel.testEventCode) payload.test_event_code = pixel.testEventCode;
  const body = JSON.stringify(payload); // serializa UMA vez (reusado no retry)

  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 600)); // backoff curto
    try {
      const resp = await fetchWithTimeout(TIKTOK_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Access-Token': accessToken },
        body
      }, 6000);
      // 5xx = instabilidade do TikTok → vale retry; 4xx = erro nosso → não vale
      if (resp.status >= 500 && attempt === 0) { lastErr = new Error('HTTP ' + resp.status); continue; }
      const json = await resp.json().catch(() => ({}));
      const ok = json && json.code === 0;
      pushLog({
        acc: pixel.acc || null,
        pixel: pixel.slug || pixel.pixelCode,
        event: p.event,
        eventId,
        leadId: p.leadId,
        status: ok ? 'ok' : 'erro',
        emq: emq.score,
        emqFields: emq.fields,
        response: { code: json.code, message: json.message || json.msg, retry: attempt || undefined }
      });
      return { ...json, pixel: pixelId, pixelName };
    } catch (err) {
      lastErr = err; // rede/timeout → tenta de novo uma vez
    }
  }
  pushLog({
    acc: pixel.acc || null,
    pixel: pixel.slug || pixel.pixelCode,
    event: p.event,
    eventId,
    leadId: p.leadId,
    status: 'erro',
    emq: emq.score,
    emqFields: emq.fields,
    response: { message: (lastErr && lastErr.message) || 'falha desconhecida', retried: true }
  });
  // Erro NÃO-retryável (TypeError = header/argumento inválido, não é rede): tentar
  // de novo daria o mesmo erro e faria a fila crescer sem fim. Não re-enfileira.
  const nonRetryable = lastErr instanceof TypeError;
  // falha de rede/5xx persistente → entra na fila de retry de longo prazo
  // (_fromRetryQueue evita re-enfileirar o que a própria fila disparou)
  if (!nonRetryable && !p._fromRetryQueue) queueRetry(pixel, p, eventId);
  return { error: (lastErr && lastErr.message) || 'falha desconhecida', pixel: pixelId, pixelName };
}

// Envia um evento de navegador para UM destino inequívoco. Este é o caminho
// seguro para páginas, SPAs e scripts externos: um token/slug explícito vence;
// sem ele, só há fallback quando existe exatamente um pixel elegível na conta.
// Nunca fazemos fan-out implícito entre dois pixels para eventos de navegação.
//
// A deduplicação também é escopada pelo pixel. O TikTok considera Pixel Code,
// nome do evento e event_id em conjunto; uma chave global por event_id fazia o
// evento do pixel A impedir o espelho CAPI do pixel B (ou, conforme a ordem,
// fazia um dispatch genérico atingir ambos). O prefixo por token/slug elimina
// essa colisão sem alterar o event_id que chega ao TikTok.
async function dispatchScoped(eventName, p, routeHint, accountId, targetSlug) {
  const acc = accountId || (p && p.acc) || null;
  const payload = p || {};
  if (MONEY_EVENTS.has(eventName) && !payload._trusted) {
    pushLog({
      acc, pixel: targetSlug || 'dispatch', event: eventName,
      eventId: payload.eventId, leadId: payload.leadId, status: 'bloqueado',
      response: { message: 'evento monetário sem origem de gateway (gateway-only)' }
    });
    return { dispatched: 0, blocked: 'gateway-only' };
  }

  const eligible = pixelStore.forEvent(acc, eventName, routeHint || '*');
  let target = null;
  if (targetSlug) {
    // Token/slug explícito vem da tag individual e é mais específico que as
    // rotas legadas. A página pode ser /produto-x mesmo que o pixel ainda tenha
    // routes=['*'] ou uma configuração antiga; só exigimos configuração válida.
    const exists = pixelStore.get(acc, targetSlug);
    target = exists && exists.active !== false && !!exists.pixelCode
      && !!(exists.events && exists.events[eventName]) ? exists : null;
    if (!target) {
      let reason = 'o pixel escolhido não existe nesta conta';
      if (exists && exists.active === false) reason = 'o pixel escolhido está inativo';
      else if (exists && !exists.pixelCode) reason = 'o pixel escolhido está sem Pixel Code';
      else if (exists) reason = 'o evento "' + eventName + '" está desligado no pixel escolhido';
      pushLog({
        acc, pixel: targetSlug, event: eventName, eventId: payload.eventId,
        leadId: payload.leadId, status: 'descartado', response: { message: reason }
      });
      return { dispatched: 0, reason, target: targetSlug };
    }
  } else if (eligible.length === 1) {
    target = eligible[0];
  } else if (eligible.length > 1) {
    const reason = 'evento sem pixel de origem; há ' + eligible.length
      + ' pixels elegíveis e o envio para todos foi bloqueado para evitar cruzamento';
    pushLog({
      acc, pixel: 'roteamento', event: eventName, eventId: payload.eventId,
      leadId: payload.leadId, status: 'descartado', response: { message: reason }
    });
    return { dispatched: 0, reason, ambiguous: true };
  } else {
    const reason = 'nenhum pixel ativo aceita este evento';
    pushLog({
      acc, pixel: targetSlug || 'roteamento', event: eventName,
      eventId: payload.eventId, leadId: payload.leadId,
      status: 'descartado', response: { message: reason }
    });
    return { dispatched: 0, reason };
  }

  if (payload.eventId) {
    const scope = target.token || ((target.acc || acc || 'legacy') + ':' + (target.slug || target.pixelCode));
    const dedupKey = 'pixel:' + scope + ':' + payload.eventId;
    let seen = false;
    if (rdb.enabled) {
      seen = await rdb.seenEventId(dedupKey).catch(() => false);
    } else {
      const now = Date.now();
      if (scopedDedup.size > 5000) {
        for (const [key, at] of scopedDedup) {
          if (now - at > 2 * 3600e3) scopedDedup.delete(key);
        }
      }
      seen = scopedDedup.has(dedupKey);
      if (!seen) scopedDedup.set(dedupKey, now);
    }
    if (seen) return { dispatched: 0, deduplicated: true, pixel: target.slug };
  }
  const result = await sendToPixel(target, { ...payload, event: eventName });
  return { dispatched: 1, pixel: target.slug, results: [result] };
}

/**
 * Dispara um evento para TODOS os pixels ativos que aceitam esse evento na rota.
 * Multi-tenant: quando accountId é informado, só dispara para os pixels da conta.
 * @param {string} eventName
 * @param {object} p           Payload (identidade, valor, url…)
 * @param {string} [routeHint] Rota para filtrar pixels (padrão '*')
 * @param {string} [accountId] Conta dona dos pixels (isola tenants)
 */
async function dispatchToAll(eventName, p, routeHint, accountId) {
  const acc = accountId || p.acc || null;

  // ── Trava gateway-only para eventos de DINHEIRO ──────────────────────────
  // Venda/pagamento só pode ser disparado por origem confiável: webhook do
  // gateway (/hook/:token) ou /api/conversion, que passam p._trusted = true.
  // Qualquer disparo client-side (beacon /px) ou automático de evento monetário
  // é BLOQUEADO aqui — impede venda "fantasma" sem confirmação do gateway.
  if (MONEY_EVENTS.has(eventName) && !p._trusted) {
    pushLog({
      acc,
      pixel: 'dispatch',
      event: eventName,
      eventId: p.eventId,
      leadId: p.leadId,
      status: 'bloqueado',
      response: { message: 'evento monetário sem origem de gateway (gateway-only)' }
    });
    return { dispatched: 0, blocked: 'gateway-only' };
  }

  let targets = pixelStore.forEvent(acc, eventName, routeHint || '*');

  // ── Isolamento pixel ↔ gateway (eventos monetários) ──────────────────────
  // Pixel com `gatewayIds` preenchido só aceita eventos de DINHEIRO vindos dos
  // gateways listados. Assim 2 pixels em 2 gateways diferentes na mesma conta
  // nunca recebem a venda um do outro. A ordem de decisão é: pixel persistido
  // no lead/link → vínculo explícito do gateway → único pixel livre. Dois ou
  // mais pixels livres são ambíguos e não recebem fan-out.
  if (MONEY_EVENTS.has(eventName)) {
    const skipped = [];
    const requestedSlug = cleanStr(p.pixelSlug, 40);
    const requested = requestedSlug ? targets.find((px) => px.slug === requestedSlug) : null;
    if (requested) {
      // A origem do lead/link é a evidência mais específica. Um vínculo de
      // gateway explícito ainda precisa casar; não ignoramos uma restrição que
      // o operador configurou de propósito.
      const bound = Array.isArray(requested.gatewayIds) ? requested.gatewayIds : [];
      const allowed = !bound.length || (!!p.gatewayId && bound.indexOf(p.gatewayId) >= 0);
      targets.forEach((px) => { if (px !== requested || !allowed) skipped.push(px); });
      targets = allowed ? [requested] : [];
    } else {
      const boundMatches = targets.filter((px) => {
        const bound = Array.isArray(px.gatewayIds) ? px.gatewayIds : [];
        return bound.length > 0 && !!p.gatewayId && bound.indexOf(p.gatewayId) >= 0;
      });
      const unbound = targets.filter((px) => !Array.isArray(px.gatewayIds) || px.gatewayIds.length === 0);
      if (boundMatches.length) {
        // Havendo vínculo explícito para o gateway, ele é a fonte da verdade;
        // pixels livres não recebem uma cópia adicional.
        targets.forEach((px) => { if (!boundMatches.includes(px)) skipped.push(px); });
        targets = boundMatches;
      } else if (unbound.length === 1) {
        // Compatibilidade segura para contas com um único pixel sem vínculo.
        targets.forEach((px) => { if (px !== unbound[0]) skipped.push(px); });
        targets = unbound;
      } else if (unbound.length > 1) {
        // Dois pixels livres são ambíguos. O comportamento antigo enviava a
        // mesma venda para ambos; agora bloqueamos até que o lead ou gateway
        // identifique o destino.
        skipped.push(...targets);
        targets = [];
      } else {
        skipped.push(...targets);
        targets = [];
      }
    }
    // Diagnóstico: registra cada pixel PULADO pelo vínculo — sem isto, o
    // operador não saberia por que a venda não chegou naquele pixel.
    skipped.forEach((px) => {
      pushLog({
        acc,
        pixel: px.name || px.slug,
        event: eventName,
        eventId: p.eventId,
        leadId: p.leadId,
        status: 'descartado',
        response: {
          message: requestedSlug && px.slug !== requestedSlug
            ? 'evento atribuído ao pixel ' + requestedSlug + '; fan-out bloqueado'
            : (p.gatewayId
              ? 'pixel não é o destino explícito do gateway ' + p.gatewayId + '; fan-out bloqueado'
              : 'evento sem pixel/gateway inequívoco; fan-out bloqueado para evitar cruzamento')
        }
      });
    });
  }

  if (!targets.length) {
    // Diagnóstico (item 54): descobre POR QUE não há alvo. Sem isto, um evento
    // descartado por descasamento de conta ou pixel inativo somia em silêncio.
    let reason = 'nenhum pixel ativo aceita este evento';
    try {
      const all = pixelStore.list(acc) || [];
      if (!all.length) {
        reason = acc ? 'nenhum pixel cadastrado para a conta ' + acc : 'nenhum pixel cadastrado';
      } else if (!all.some((px) => px.active)) {
        reason = 'há pixels na conta, mas todos inativos';
      } else if (!all.some((px) => px.events && px.events[eventName])) {
        reason = 'pixels ativos existem, mas nenhum tem o evento "' + eventName + '" ligado';
      } else if (MONEY_EVENTS.has(eventName)) {
        reason = requestedSlug
          ? 'o pixel atribuído ao lead não aceita este gateway/evento'
          : 'destino ambíguo: vincule cada pixel a um gateway ou instale a tag específica para atribuir o lead';
      } else {
        reason = 'pixels ativos existem, mas não casaram com a rota/conta (accountId=' + (acc || 'null') + ')';
      }
    } catch (_) {}
    pushLog({
      acc,
      pixel: 'dispatch',
      event: eventName,
      eventId: p.eventId,
      leadId: p.leadId,
      status: 'descartado',
      response: { message: reason }
    });
    return { dispatched: 0, reason };
  }
  // allSettled: um pixel com problema NUNCA derruba o disparo dos demais
  const settled = await Promise.allSettled(
    targets.map((px) => sendToPixel(px, { ...p, event: eventName }))
  );
  const results = settled.map((s, i) => (s.status === 'fulfilled'
    ? s.value
    : { error: String(s.reason), pixel: targets[i].slug || targets[i].pixelCode, pixelName: targets[i].name || targets[i].slug }));
  return { dispatched: targets.length, results };
}

/**
 * Envio de teste (painel): valida token/pixel na hora e retorna a resposta crua.
 */
// Eventos que o painel pode disparar em teste (nomes oficiais da Events API)
const TEST_EVENTS = ['ViewContent', 'AddToCart', 'InitiateCheckout', 'AddPaymentInfo', 'CompletePayment'];

async function testPixel(pixel, ctx) {
  ctx = ctx || {};
  const eventId = 'test.' + crypto.randomBytes(6).toString('hex');
  // Evento escolhível pelo painel (default ViewContent); valida contra a lista
  const eventName = TEST_EVENTS.includes(ctx.event) ? ctx.event : 'ViewContent';
  // Moeda da conta (fallback BRL) — antes era EUR fixo
  const cur = String(ctx.currency || '').toUpperCase();
  // A Events API exige AO MENOS UM identificador de usuário (ip+ua, email,
  // phone, ttclid ou external_id). Sem isso o teste falhava SEMPRE com erro
  // de parâmetro, mesmo com código/token corretos. Usa o ip/ua reais de quem
  // clicou em "Testar" + um external_id sintético como sinal extra.
  const json = await sendToPixel(pixel, {
    event: eventName,
    eventId,
    url: 'https://example.com/teste-pixel',
    ip: ctx.ip,
    userAgent: ctx.userAgent,
    externalId: hash('teste-painel.' + eventId),
    value: 0,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : 'BRL'
  });
  // ok explícito: o painel decide sucesso/falha por este campo (code 0 = aceito)
  const ok = !!(json && json.code === 0);
  const rawMsg = (json && (json.message || json.msg || json.error)) || undefined;
  return {
    ok,
    event: eventName,
    eventId,
    code: json ? json.code : undefined,
    message: rawMsg,
    // Tradução pt-BR amigável do erro (null quando sucesso)
    messagePtBr: ok ? null : traduzErroTikTok(json ? json.code : undefined, rawMsg),
    response: json
  };
}

// Compat: assinatura antiga (1 pixel via env). Redireciona para dispatchToAll.
async function sendTikTokEvent(p) {
  return dispatchToAll(p.event, p, p.route || '*', p.acc || null);
}

module.exports = {
  hash, hashPhone, externalIdFromLead,
  sendToPixel, dispatchScoped, dispatchToAll, testPixel, sendTikTokEvent,
  recentLog, recentLogAsync, clearLog, // Item 200
  retryQueueSize, drainRetryQueue, retryQueueInfo
};
