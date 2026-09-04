'use strict';

// Sincroniza pastas do Google Drive/Dropbox com a biblioteca de criativos do
// TikTok. Credenciais OAuth ficam cifradas no Neon; a config guarda somente a
// pasta e o interruptor. Cada arquivo é idempotente por provider + file_id.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { neon } = require('@neondatabase/serverless');
const config = require('./config');
const storage = require('./ads-storage');
const adsProvider = require('./ads-provider');

const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL || null;
const sql = URL ? neon(URL) : null;
const PROVIDERS = ['googleDrive', 'dropbox'];
const MAX_VIDEO_BYTES = Math.max(10, Math.min(2000, Number(process.env.CLOUD_VIDEO_MAX_MB) || 500)) * 1024 * 1024;
const SYNC_MS = Math.max(60_000, Number(process.env.CLOUD_VIDEO_SYNC_MS) || 2 * 60_000);
let schemaReady = null;
let timer = null;
let running = false;

function keyMaterial() {
  const raw = process.env.INTEGRATION_TOKEN_KEY || process.env.SESSION_SECRET || process.env.AUTH_SECRET || '';
  if (raw.length < 24) throw new Error('INTEGRATION_TOKEN_KEY (mínimo 24 caracteres) é obrigatória para conexões de nuvem');
  return crypto.createHash('sha256').update(raw).digest();
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
}

function decrypt(value) {
  const raw = Buffer.from(String(value || ''), 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', keyMaterial(), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8'));
}

async function ensureSchema() {
  if (!sql) return false;
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    await sql`CREATE TABLE IF NOT EXISTS cloud_video_connections (
      account_id text NOT NULL,
      provider text NOT NULL,
      credentials_enc text NOT NULL,
      connected_email text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, provider)
    )`;
    await sql`CREATE TABLE IF NOT EXISTS cloud_video_files (
      account_id text NOT NULL,
      provider text NOT NULL,
      file_id text NOT NULL,
      advertiser_id text NOT NULL,
      name text NOT NULL,
      source_modified_at timestamptz,
      status text NOT NULL DEFAULT 'pending',
      tiktok_video_id text,
      error text,
      processed_at timestamptz,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (account_id, provider, file_id, advertiser_id)
    )`;
    return true;
  })().catch((error) => { schemaReady = null; throw error; });
  return schemaReady;
}

function providerEnv(providerName) {
  if (providerName === 'googleDrive') return {
    clientId: process.env.GOOGLE_DRIVE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_DRIVE_CLIENT_SECRET,
  };
  if (providerName === 'dropbox') return {
    clientId: process.env.DROPBOX_APP_KEY,
    clientSecret: process.env.DROPBOX_APP_SECRET,
  };
  return {};
}

function assertProvider(value) {
  if (!PROVIDERS.includes(value)) { const error = new Error('Provedor de vídeo inválido'); error.status = 400; throw error; }
  return value;
}

function callbackUrl(providerName) {
  const raw = String(process.env.OAUTH_PUBLIC_ORIGIN || process.env.PRIMARY_HOST || process.env.RAILWAY_PUBLIC_DOMAIN || '').trim();
  if (!raw) throw new Error('OAUTH_PUBLIC_ORIGIN ou PRIMARY_HOST é obrigatório para OAuth');
  const origin = /^https?:\/\//i.test(raw) ? raw.replace(/\/$/, '') : 'https://' + raw.replace(/\/$/, '');
  return origin + '/api/integrations/videos/' + providerName + '/callback';
}

function stateToken(accountId, providerName) {
  const payload = Buffer.from(JSON.stringify({ accountId, provider: providerName, at: Date.now(), nonce: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', keyMaterial()).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifyState(token, accountId, providerName) {
  const [payload, supplied] = String(token || '').split('.');
  const expected = crypto.createHmac('sha256', keyMaterial()).update(payload || '').digest('base64url');
  if (!supplied || supplied.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new Error('Estado OAuth inválido');
  const value = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (value.accountId !== accountId || value.provider !== providerName || Date.now() - value.at > 15 * 60e3) throw new Error('Estado OAuth expirado ou incompatível');
  return value;
}

function authorizationUrl(accountId, providerName) {
  providerName = assertProvider(providerName);
  const env = providerEnv(providerName);
  if (!env.clientId || !env.clientSecret) { const error = new Error('Credenciais OAuth de ' + providerName + ' não configuradas'); error.status = 503; throw error; }
  const state = stateToken(accountId, providerName);
  const redirectUri = callbackUrl(providerName);
  if (providerName === 'googleDrive') {
    const params = new URLSearchParams({ client_id: env.clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'https://www.googleapis.com/auth/drive.readonly openid email', access_type: 'offline', prompt: 'consent', state });
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + params;
  }
  const params = new URLSearchParams({ client_id: env.clientId, redirect_uri: redirectUri, response_type: 'code', token_access_type: 'offline', state });
  return 'https://www.dropbox.com/oauth2/authorize?' + params;
}

async function exchangeCode(accountId, providerName, code, state) {
  providerName = assertProvider(providerName);
  verifyState(state, accountId, providerName);
  const env = providerEnv(providerName);
  const tokenUrl = providerName === 'googleDrive' ? 'https://oauth2.googleapis.com/token' : 'https://api.dropboxapi.com/oauth2/token';
  const body = new URLSearchParams({ code: String(code || ''), grant_type: 'authorization_code', client_id: env.clientId, client_secret: env.clientSecret, redirect_uri: callbackUrl(providerName) });
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
  const token = await response.json().catch(() => ({}));
  if (!response.ok || !token.access_token) { const error = new Error(String(token.error_description || token.error || 'Falha ao conectar a nuvem')); error.status = 502; throw error; }
  token.expires_at = token.expires_in ? Date.now() + Number(token.expires_in) * 1000 : null;
  await ensureSchema();
  await sql`INSERT INTO cloud_video_connections (account_id, provider, credentials_enc, updated_at)
    VALUES (${accountId}, ${providerName}, ${encrypt(token)}, now())
    ON CONFLICT (account_id, provider) DO UPDATE SET credentials_enc = EXCLUDED.credentials_enc, updated_at = now()`;
  return { ok: true, provider: providerName };
}

async function connection(accountId, providerName) {
  if (!sql) return null;
  await ensureSchema();
  const rows = await sql`SELECT credentials_enc, connected_email, updated_at FROM cloud_video_connections WHERE account_id = ${accountId} AND provider = ${providerName} LIMIT 1`;
  if (!rows[0]) return null;
  return { token: decrypt(rows[0].credentials_enc), email: rows[0].connected_email || null, updatedAt: rows[0].updated_at };
}

async function saveToken(accountId, providerName, token) {
  await sql`UPDATE cloud_video_connections SET credentials_enc = ${encrypt(token)}, updated_at = now() WHERE account_id = ${accountId} AND provider = ${providerName}`;
}

async function validAccessToken(accountId, providerName, con) {
  const token = con.token;
  if (!token.expires_at || token.expires_at - Date.now() > 60_000) return token.access_token;
  if (!token.refresh_token) throw new Error('Conexão expirada; reconecte o ' + providerName);
  const env = providerEnv(providerName);
  const tokenUrl = providerName === 'googleDrive' ? 'https://oauth2.googleapis.com/token' : 'https://api.dropboxapi.com/oauth2/token';
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: token.refresh_token, client_id: env.clientId, client_secret: env.clientSecret });
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(15_000) });
  const refreshed = await response.json().catch(() => ({}));
  if (!response.ok || !refreshed.access_token) throw new Error('Não foi possível renovar o acesso ao ' + providerName);
  const next = { ...token, ...refreshed, refresh_token: refreshed.refresh_token || token.refresh_token, expires_at: refreshed.expires_in ? Date.now() + Number(refreshed.expires_in) * 1000 : null };
  await saveToken(accountId, providerName, next);
  return next.access_token;
}

async function listFiles(accountId, providerName, accessToken) {
  const pref = (config.get(accountId).cloudVideo || {})[providerName] || {};
  if (providerName === 'googleDrive') {
    const folder = String(pref.folderId || '').trim();
    const query = "trashed = false and mimeType contains 'video/'" + (folder ? " and '" + folder.replace(/'/g, "\\'") + "' in parents" : '');
    const params = new URLSearchParams({ q: query, fields: 'files(id,name,mimeType,size,modifiedTime)', pageSize: '100', orderBy: 'modifiedTime desc' });
    const response = await fetch('https://www.googleapis.com/drive/v3/files?' + params, { headers: { authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(15_000) });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(String(json.error && json.error.message || 'Falha ao listar Google Drive'));
    return (json.files || []).map((file) => ({ id: file.id, name: file.name, size: Number(file.size) || 0, modifiedAt: file.modifiedTime, downloadUrl: 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(file.id) + '?alt=media' }));
  }
  const response = await fetch('https://api.dropboxapi.com/2/files/list_folder', {
    method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'content-type': 'application/json' },
    body: JSON.stringify({ path: String(pref.folderPath || ''), recursive: false, limit: 100 }), signal: AbortSignal.timeout(15_000),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(String(json.error_summary || 'Falha ao listar Dropbox'));
  return (json.entries || []).filter((file) => file['.tag'] === 'file' && /\.(mp4|mov|webm|m4v)$/i.test(file.name || ''))
    .map((file) => ({ id: file.id, name: file.name, size: Number(file.size) || 0, modifiedAt: file.server_modified, dropboxPath: file.path_lower }));
}

async function alreadyProcessed(accountId, providerName, fileId, advertiserId, modifiedAt) {
  const rows = await sql`SELECT status, source_modified_at FROM cloud_video_files WHERE account_id = ${accountId} AND provider = ${providerName} AND file_id = ${fileId} AND advertiser_id = ${advertiserId} LIMIT 1`;
  return !!(rows[0] && rows[0].status === 'uploaded' && String(rows[0].source_modified_at || '') === String(modifiedAt || ''));
}

async function downloadFile(accountId, providerName, file, accessToken) {
  if (file.size && file.size > MAX_VIDEO_BYTES) throw new Error('Arquivo excede o limite de ' + Math.round(MAX_VIDEO_BYTES / 1024 / 1024) + ' MB');
  const dir = await storage.ensureAccountDir(accountId);
  const filename = Date.now() + '-cloud-' + storage.safeName(file.name || 'video.mp4');
  const target = path.join(dir, filename);
  const response = providerName === 'googleDrive'
    ? await fetch(file.downloadUrl, { headers: { authorization: 'Bearer ' + accessToken }, signal: AbortSignal.timeout(120_000) })
    : await fetch('https://content.dropboxapi.com/2/files/download', { method: 'POST', headers: { authorization: 'Bearer ' + accessToken, 'Dropbox-API-Arg': JSON.stringify({ path: file.dropboxPath }) }, signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body) throw new Error('Download de ' + file.name + ' falhou (HTTP ' + response.status + ')');
  const length = Number(response.headers.get('content-length')) || 0;
  if (length > MAX_VIDEO_BYTES) throw new Error('Arquivo excede o limite configurado');
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(target));
  const size = (await fs.promises.stat(target)).size;
  if (size > MAX_VIDEO_BYTES) { await fs.promises.unlink(target).catch(() => {}); throw new Error('Arquivo excede o limite configurado'); }
  return { target, filename };
}

async function syncOne(accountId, providerName, advertiserId) {
  providerName = assertProvider(providerName);
  await ensureSchema();
  const con = await connection(accountId, providerName);
  if (!con) return { skipped: true, reason: 'not_connected' };
  const pref = (config.get(accountId).cloudVideo || {})[providerName] || {};
  if (!pref.enabled) return { skipped: true, reason: 'disabled' };
  const accessToken = await validAccessToken(accountId, providerName, con);
  const files = await listFiles(accountId, providerName, accessToken);
  const origin = storage.publicOrigin();
  if (!origin) throw new Error('PRIMARY_HOST público é obrigatório para o TikTok baixar vídeos');
  const results = [];
  for (const file of files.slice(0, 20)) {
    if (await alreadyProcessed(accountId, providerName, file.id, advertiserId, file.modifiedAt)) continue;
    let local = null;
    try {
      await sql`INSERT INTO cloud_video_files (account_id, provider, file_id, advertiser_id, name, source_modified_at, status, updated_at)
        VALUES (${accountId}, ${providerName}, ${file.id}, ${advertiserId}, ${file.name}, ${file.modifiedAt || null}, 'downloading', now())
        ON CONFLICT (account_id, provider, file_id, advertiser_id) DO UPDATE SET name = EXCLUDED.name, source_modified_at = EXCLUDED.source_modified_at, status = 'downloading', error = NULL, updated_at = now()`;
      local = await downloadFile(accountId, providerName, file, accessToken);
      const videoUrl = origin + '/uploads/' + storage.safeSegment(accountId) + '/' + encodeURIComponent(local.filename);
      const uploaded = await adsProvider.uploadVideoAsset(advertiserId, videoUrl);
      await sql`UPDATE cloud_video_files SET status = 'uploaded', tiktok_video_id = ${uploaded.videoId}, error = NULL, processed_at = now(), updated_at = now()
        WHERE account_id = ${accountId} AND provider = ${providerName} AND file_id = ${file.id} AND advertiser_id = ${advertiserId}`;
      results.push({ fileId: file.id, name: file.name, videoId: uploaded.videoId, ok: true });
    } catch (error) {
      await sql`UPDATE cloud_video_files SET status = 'failed', error = ${String(error.message || error).slice(0, 400)}, updated_at = now()
        WHERE account_id = ${accountId} AND provider = ${providerName} AND file_id = ${file.id} AND advertiser_id = ${advertiserId}`.catch(() => {});
      results.push({ fileId: file.id, name: file.name, ok: false, error: String(error.message || error) });
    }
  }
  return { ok: true, files: results, checked: files.length };
}

async function status(accountId) {
  const out = {};
  for (const providerName of PROVIDERS) {
    const env = providerEnv(providerName);
    const con = await connection(accountId, providerName).catch(() => null);
    const pref = (config.get(accountId).cloudVideo || {})[providerName] || {};
    out[providerName] = { configured: !!(env.clientId && env.clientSecret), connected: !!con, enabled: pref.enabled === true, folderId: pref.folderId || '', folderPath: pref.folderPath || '', connectedAt: con && con.updatedAt || null };
  }
  return out;
}

async function listActivity(accountId, limit = 50) {
  if (!sql) return [];
  await ensureSchema();
  return sql`SELECT provider, file_id, advertiser_id, name, status, tiktok_video_id, error, processed_at, updated_at FROM cloud_video_files WHERE account_id = ${accountId} ORDER BY updated_at DESC LIMIT ${Math.min(100, Math.max(1, Number(limit) || 50))}`;
}

async function disconnect(accountId, providerName) {
  providerName = assertProvider(providerName);
  if (!sql) return false;
  await ensureSchema();
  await sql`DELETE FROM cloud_video_connections WHERE account_id = ${accountId} AND provider = ${providerName}`;
  const cloud = config.get(accountId).cloudVideo || {};
  config.set(accountId, { cloudVideo: { ...cloud, [providerName]: { ...(cloud[providerName] || {}), enabled: false } } });
  return true;
}

async function tick() {
  if (running || !sql || !adsProvider.enabled) return;
  running = true;
  try {
    await ensureSchema();
    const rows = await sql`SELECT account_id, provider FROM cloud_video_connections ORDER BY updated_at`;
    const adsCache = require('./ads-cache-store');
    for (const row of rows) {
      const pref = (config.get(row.account_id).cloudVideo || {})[row.provider] || {};
      if (!pref.enabled) continue;
      const states = await adsCache.listSyncStates(row.account_id).catch(() => []);
      const advertiserId = String(pref.advertiserId || states[0] && states[0].advertiser_id || '');
      if (!advertiserId) continue;
      await syncOne(row.account_id, row.provider, advertiserId).catch((error) => console.warn('[cloud-video] ' + row.provider + ': ' + error.message));
    }
  } finally { running = false; }
}

function start() {
  if (timer || !sql) return;
  timer = setInterval(() => { tick().catch(() => {}); }, SYNC_MS);
  if (timer.unref) timer.unref();
  setTimeout(() => { tick().catch(() => {}); }, 20_000).unref();
}

module.exports = { PROVIDERS, ensureSchema, authorizationUrl, exchangeCode, syncOne, status, listActivity, disconnect, start, _internals: { encrypt, decrypt, verifyState, stateToken } };
