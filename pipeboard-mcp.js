// ─────────────────────────────────────────────────────────────────────────────
// pipeboard-mcp.js — Cliente Streamable HTTP MCP do Pipeboard (TikTok Ads).
//
// Transporte puro para o servidor MCP do Pipeboard em
// https://tiktok-ads.mcp.pipeboard.co/ . NÃO conhece regra de negócio nem shape
// do dashboard — isso vive no ads-provider.js (Gate 2). Aqui só JSON-RPC 2.0
// sobre HTTP com suporte a resposta JSON OU SSE, sessão MCP e retry.
//
// Auth server-to-server (docs oficiais): headers
//   Authorization: Bearer pk_...
//   X-Pipeboard-Token: pk_...
// A chave NUNCA sai do servidor. Todas as chamadas MCP são server-side.
//
// Handshake (Streamable HTTP):
//   1. POST initialize            → captura o header Mcp-Session-Id
//   2. POST notifications/initialized (com a sessão)
//   3. POST tools/list | tools/call (com a sessão + MCP-Protocol-Version)
//
// Robustez:
//   • Timeout 60s por chamada (criação/upload de vídeo é síncrono e lento).
//   • 1 retry com re-handshake transparente se a sessão MCP expirar (404).
//   • Limite caseiro de 4 chamadas simultâneas p/ não estourar o rate limit.
//   • Resposta SSE ou JSON: extrai a mensagem JSON-RPC do id correspondente.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';

const MCP_URL =
  process.env.PIPEBOARD_TIKTOK_MCP_URL || 'https://tiktok-ads.mcp.pipeboard.co/';

// O Pipeboard oferece, para colar, a "MCP URL" completa
// (https://…mcp.pipeboard.co/?token=pipeboard_XXXX) além da API Key pura.
// É muito fácil colar a URL inteira em PIPEBOARD_API_KEY por engano — então
// aceitamos os dois: se vier uma URL com ?token=, extraímos o token.
function extractPipeboardToken(raw) {
  const v = String(raw || '').trim();
  const m = v.match(/[?&]token=([^&\s]+)/);
  return m ? decodeURIComponent(m[1]) : v;
}
const KEY = extractPipeboardToken(process.env.PIPEBOARD_API_KEY || '');
const PROTOCOL_VERSION = '2025-06-18';

// Formato do token do Pipeboard: hoje o prefixo é `pipeboard_`; chaves antigas
// usavam `pk_`. Aceitamos ambos (comprimento varia por tipo) para não recusar a
// chave nova como "não configurada" — o bug que fazia a aba dizer "Integração
// não configurada no servidor" mesmo com a chave preenchida.
const enabled = /^(pipeboard_|pk_)[A-Za-z0-9._-]{8,}$/.test(KEY);

// ── Estado da sessão MCP (modelo Pipeboard é conta única / server-to-server) ──
let _sessionId = null; // valor do header Mcp-Session-Id devolvido no initialize
let _initPromise = null; // dedupe de handshakes concorrentes
let _rpcId = 0;

function nextId() {
  _rpcId += 1;
  return _rpcId;
}

// ── Semáforo caseiro: no máximo 4 requisições MCP em voo ──────────────────────
let _active = 0;
const _waiters = [];
function acquire() {
  if (_active < 4) {
    _active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => _waiters.push(resolve));
}
function release() {
  _active -= 1;
  const next = _waiters.shift();
  if (next) {
    _active += 1;
    next();
  }
}

// ── Erros tipados (a taxonomia HTTP vive no provider/rotas) ───────────────────
function errKeyMissing() {
  const err = new Error('PIPEBOARD_API_KEY ausente ou inválida no servidor');
  err.status = 401;
  err.pipeboard = { connect: 'pipeboard' };
  return err;
}

function throwHttpError(status, bodyText) {
  let detail = bodyText;
  try {
    const j = JSON.parse(bodyText);
    detail = j.error || j.message || bodyText;
  } catch (_) {
    /* corpo não-JSON: usa o texto cru */
  }
  const err = new Error('Pipeboard MCP HTTP ' + status + (detail ? ': ' + String(detail).slice(0, 300) : ''));
  err.status = status;
  if (status === 401 || status === 403) {
    err.pipeboard = { connect: 'pipeboard' };
  } else if (status === 429) {
    err.retryAfter = 2;
  } else if (status === 404) {
    // sessão MCP expirada/desconhecida → sinaliza re-handshake
    err.__sessionExpired = true;
  }
  throw err;
}

// ── Parsing de resposta: SSE (text/event-stream) OU JSON puro ─────────────────
// SSE: eventos separados por linha em branco; concatena as linhas `data:` de
// cada evento e faz JSON.parse. Retorna todas as mensagens JSON-RPC achadas.
function extractSseMessages(text) {
  const out = [];
  const blocks = text.split(/\r?\n\r?\n/);
  for (const block of blocks) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).replace(/^ /, ''));
    if (!dataLines.length) continue;
    try {
      out.push(JSON.parse(dataLines.join('\n')));
    } catch (_) {
      /* evento sem JSON válido (ex.: ping) — ignora */
    }
  }
  return out;
}

function parseMessages(text, contentType) {
  if (!text) return [];
  if (contentType && contentType.includes('text/event-stream')) {
    return extractSseMessages(text);
  }
  try {
    const j = JSON.parse(text);
    return Array.isArray(j) ? j : [j];
  } catch (_) {
    return [];
  }
}

// ── POST bruto de um envelope JSON-RPC ────────────────────────────────────────
async function post(payload, { timeoutMs = 60000, includeSession = true } = {}) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: 'Bearer ' + KEY,
    'X-Pipeboard-Token': KEY,
  };
  if (includeSession && _sessionId) {
    headers['Mcp-Session-Id'] = _sessionId;
    headers['MCP-Protocol-Version'] = PROTOCOL_VERSION;
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(
      e.name === 'AbortError'
        ? 'Pipeboard MCP: tempo limite excedido'
        : 'Pipeboard MCP: falha de rede (' + e.message + ')'
    );
    err.status = 502;
    throw err;
  }
  // O timeout precisa cobrir tambem o consumo do corpo. O transporte MCP pode
  // responder os headers e manter um stream SSE aberto; limpar o timer aqui
  // deixava o worker de catalogo preso para sempre em res.text().
  Object.defineProperty(res, '__pipeboardTimer', { value: timer, configurable: true });
  return res;
}

async function responseText(res) {
  try {
    return await res.text();
  } catch (e) {
    const err = new Error(
      e && e.name === 'AbortError'
        ? 'Pipeboard MCP: tempo limite excedido'
        : 'Pipeboard MCP: falha ao ler resposta (' + String(e && e.message || e) + ')'
    );
    err.status = 502;
    throw err;
  } finally {
    clearTimeout(res && res.__pipeboardTimer);
  }
}

// ── Requisição JSON-RPC (espera resposta com id) ──────────────────────────────
async function sendRequest(method, params, opts = {}) {
  const id = nextId();
  const res = await post({ jsonrpc: '2.0', id, method, params: params || {} }, opts);

  // Captura/atualiza a sessão a partir do header (initialize devolve aqui).
  const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sid) _sessionId = sid;

  const text = await responseText(res);
  if (!res.ok) throwHttpError(res.status, text);

  const contentType = res.headers.get('content-type') || '';
  const messages = parseMessages(text, contentType);
  const msg = messages.find((m) => m && m.id === id) || messages[0];
  if (!msg) {
    const err = new Error('Pipeboard MCP: resposta sem mensagem JSON-RPC para ' + method);
    err.status = 502;
    throw err;
  }
  if (msg.error) {
    const detail = msg.error.message || 'erro JSON-RPC';
    const err = new Error('Pipeboard MCP: ' + detail);
    err.status = 502;
    err.rpc = msg.error;
    // Alguns servidores sinalizam sessão inválida via erro JSON-RPC, não 404.
    if (/session/i.test(detail) && /(invalid|expired|not found|unknown)/i.test(detail)) {
      err.__sessionExpired = true;
    }
    throw err;
  }
  return msg.result;
}

// Notificação JSON-RPC (sem id, sem resposta esperada além do 202).
async function sendNotification(method, params) {
  const res = await post({ jsonrpc: '2.0', method, params: params || {} });
  if (!res.ok && res.status !== 202) {
    const text = await responseText(res);
    throwHttpError(res.status, text);
  }
  // corpo irrelevante; drena para liberar o socket
  try {
    await responseText(res);
  } catch (_) {
    /* ok */
  }
}

// ── Handshake ─────────────────────────────────────────────────────────────────
async function initialize() {
  _sessionId = null;
  const result = await sendRequest(
    'initialize',
    {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'roi-nados-dashboard', version: '1.0.0' },
    },
    { includeSession: false }
  );
  // Após o initialize a sessão já foi capturada do header em sendRequest.
  await sendNotification('notifications/initialized', {});
  return result;
}

function ensureSession() {
  if (_sessionId) return Promise.resolve();
  if (!_initPromise) {
    _initPromise = initialize().finally(() => {
      _initPromise = null;
    });
  }
  return _initPromise;
}

// Executa fn garantindo sessão; em expiração de sessão, refaz o handshake 1×.
async function withSession(fn) {
  await ensureSession();
  try {
    return await fn();
  } catch (err) {
    if (err && err.__sessionExpired) {
      _sessionId = null;
      await ensureSession();
      return await fn();
    }
    throw err;
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

// listTools — boot/diagnóstico: valida auth e devolve os JSON Schemas REAIS.
async function listTools() {
  if (!enabled) throw errKeyMissing();
  await acquire();
  try {
    const result = await withSession(() => sendRequest('tools/list', {}));
    return result || { tools: [] };
  } finally {
    release();
  }
}

// Extrai o payload útil de um resultado tools/call. O MCP devolve
// { content: [{ type:'text', text }], isError }. Tentamos JSON.parse defensivo
// do primeiro bloco de texto; se não for JSON, devolvemos o texto cru.
function extractContent(result) {
  if (!result || !Array.isArray(result.content)) return result;
  const textPart = result.content.find((c) => c && c.type === 'text' && typeof c.text === 'string');
  if (!textPart) return result.content;
  try {
    return JSON.parse(textPart.text);
  } catch (_) {
    return textPart.text;
  }
}

// ── Contador de chamadas (observabilidade / diagnóstico) ────────────────────
// Antes não havia como saber quantas chamadas o app fazia ao Pipeboard. Com o
// espelho no Neon, o caminho de leitura ficou local e as ÚNICAS chamadas ao
// provider passam a ser o sync + as escritas — este contador prova isso no
// /diag. Mantém o total desde o boot + um ring buffer de timestamps para
// derivar "chamadas na última hora" sem crescer indefinidamente.
const callStats = { total: 0, byTool: {}, recent: [], errors: [], lastError: null };
function recordCall(name) {
  callStats.total += 1;
  callStats.byTool[name] = (callStats.byTool[name] || 0) + 1;
  const now = Date.now();
  callStats.recent.push(now);
  // mantém só a última hora
  const cutoff = now - 3600 * 1000;
  if (callStats.recent.length > 2000 || callStats.recent[0] < cutoff) {
    callStats.recent = callStats.recent.filter((t) => t >= cutoff);
  }
}
function recordError(name, err) {
  const now = Date.now();
  callStats.errors.push(now);
  const cutoff = now - 3600 * 1000;
  if (callStats.errors.length > 500 || (callStats.errors[0] || now) < cutoff) {
    callStats.errors = callStats.errors.filter((t) => t >= cutoff);
  }
  // guarda só o resumo do último erro (sem payloads — podem ter dados da conta)
  callStats.lastError = {
    at: new Date(now).toISOString(),
    tool: String(name || '').slice(0, 60),
    message: String((err && err.message) || 'erro').slice(0, 200),
    code: (err && err.code) || null,
  };
}
function getCallStats() {
  const now = Date.now();
  const recent = callStats.recent.filter((t) => t >= now - 3600 * 1000);
  const errors = callStats.errors.filter((t) => t >= now - 3600 * 1000);
  return {
    total: callStats.total,
    lastMinute: recent.filter((t) => t >= now - 60 * 1000).length,
    lastHour: recent.length,
    errorsLastHour: errors.length,
    lastError: callStats.lastError,
    byTool: Object.assign({}, callStats.byTool),
  };
}

// ── Diagnóstico de conexão (cacheado) ────────────────────────────────────────
// O painel MCP da dashboard poderia derrubar o rate limit se cada render
// fizesse um tools/list. Cache de 5min: 1 chamada real a cada 5min no máximo,
// compartilhada por todos os usuários. force=true ignora o cache (botão
// "testar conexão").
let _diagCache = null; // { at:ms, ok, toolCount, tools:[nomes] }
async function getDiagnostics({ force } = {}) {
  if (!enabled) return { ok: false, enabled: false, toolCount: 0, tools: [], error: 'PIPEBOARD_API_KEY ausente' };
  if (!force && _diagCache && Date.now() - _diagCache.at < 5 * 60e3) {
    return Object.assign({ cached: true }, _diagCache.data);
  }
  try {
    const r = await listTools();
    const tools = (r.tools || []).map((t) => t.name);
    const data = { ok: true, enabled: true, toolCount: tools.length, tools, checkedAt: new Date().toISOString() };
    _diagCache = { at: Date.now(), data };
    return data;
  } catch (err) {
    const data = {
      ok: false, enabled: true, toolCount: 0, tools: [],
      error: String(err.message || 'falha').slice(0, 200), checkedAt: new Date().toISOString(),
    };
    // cache curto para erro (1min): não martela um servidor com problema
    _diagCache = { at: Date.now() - 4 * 60e3, data };
    return data;
  }
}

// callToolRaw — resultado bruto do tools/call (content + isError).
async function callToolRaw(name, args, opts = {}) {
  if (!enabled) throw errKeyMissing();
  await acquire();
  recordCall(name);
  try {
    return await withSession(() =>
      sendRequest('tools/call', { name, arguments: args || {} }, { timeoutMs: opts.timeoutMs || 60000 })
    );
  } catch (err) {
    recordError(name, err);
    throw err;
  } finally {
    release();
  }
}

// callTool — resultado já desembrulhado; isError vira exceção tipada (502).
async function callTool(name, args, opts = {}) {
  const result = await callToolRaw(name, args, opts);
  if (result && result.isError) {
    const detail = extractContent(result);
    const msg = (typeof detail === 'string' ? detail : JSON.stringify(detail));
    const err = new Error('TikTok/Pipeboard: ' + msg.slice(0, 400));
    err.status = 502;
    err.source = 'tiktok';
    err.detail = detail;
    // Bloqueio de conta pelo limite mensal de contas do Pipeboard (limite do
    // TIME, não por pessoa). É recuperável só quando o limite reseta — a
    // dashboard precisa distinguir isto de "conta sem campanhas".
    if (/monthly limit of \d+ ad accounts|blocked until/i.test(msg)) {
      err.code = 'ACCOUNT_BLOCKED';
      const m = msg.match(/resets? on (\d{4}-\d{2}-\d{2})|blocked until(?: the limit resets on)? (\d{4}-\d{2}-\d{2})/i);
      err.blockedUntil = (m && (m[1] || m[2])) || null;
    }
    recordError(name, err); // isError do TikTok também conta como erro no diag
    throw err;
  }
  return extractContent(result);
}

module.exports = {
  enabled,
  MCP_URL,
  PROTOCOL_VERSION,
  listTools,
  callTool,
  callToolRaw,
  getCallStats,
  getDiagnostics,
  // exposto p/ testes/diagnóstico
  _internals: { extractSseMessages, parseMessages, extractContent },
};
