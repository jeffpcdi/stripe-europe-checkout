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
const KEY = process.env.PIPEBOARD_API_KEY || '';
const PROTOCOL_VERSION = '2025-06-18';

// Chaves Pipeboard têm prefixo pk_. Mantemos a checagem tolerante (comprimento
// varia por tipo de token), mas exigimos o prefixo para não fazer handshake com
// lixo.
const enabled = /^pk_[A-Za-z0-9._-]{8,}$/.test(KEY);

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
  clearTimeout(timer);
  return res;
}

// ── Requisição JSON-RPC (espera resposta com id) ──────────────────────────────
async function sendRequest(method, params, opts = {}) {
  const id = nextId();
  const res = await post({ jsonrpc: '2.0', id, method, params: params || {} }, opts);

  // Captura/atualiza a sessão a partir do header (initialize devolve aqui).
  const sid = res.headers.get('mcp-session-id') || res.headers.get('Mcp-Session-Id');
  if (sid) _sessionId = sid;

  const text = await res.text();
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
    const text = await res.text();
    throwHttpError(res.status, text);
  }
  // corpo irrelevante; drena para liberar o socket
  try {
    await res.text();
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

// callToolRaw — resultado bruto do tools/call (content + isError).
async function callToolRaw(name, args, opts = {}) {
  if (!enabled) throw errKeyMissing();
  await acquire();
  try {
    return await withSession(() =>
      sendRequest('tools/call', { name, arguments: args || {} }, { timeoutMs: opts.timeoutMs || 60000 })
    );
  } finally {
    release();
  }
}

// callTool — resultado já desembrulhado; isError vira exceção tipada (502).
async function callTool(name, args, opts = {}) {
  const result = await callToolRaw(name, args, opts);
  if (result && result.isError) {
    const detail = extractContent(result);
    const err = new Error(
      'TikTok/Pipeboard: ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 400)
    );
    err.status = 502;
    err.source = 'tiktok';
    err.detail = detail;
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
  // exposto p/ testes/diagnóstico
  _internals: { extractSseMessages, parseMessages, extractContent },
};
