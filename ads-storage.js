// ── ads-storage.js — armazenamento local de criativos (sem Vercel Blob) ──────
// PORQUÊ: o app roda no Railway; o Vercel Blob não está disponível lá. Uploads de
// criativo (vídeo/imagem) e o feed do catálogo precisavam de uma URL PÚBLICA que
// o TikTok baixa. Este módulo grava os arquivos em disco (um Volume do Railway em
// produção) e o app os serve em /uploads/*. Zero dependência de terceiros.
//
// Durabilidade: com um Volume anexado, o Railway injeta RAILWAY_VOLUME_MOUNT_PATH
// e os arquivos sobrevivem a restart. Sem volume, cai para <raiz>/data/uploads
// (efêmero) — o envio ao TikTok ainda funciona; só a biblioteca some no restart.
const fs = require('fs');
const path = require('path');

// Diretório raiz dos uploads. Precedência: ADS_UPLOAD_DIR explícito → Volume do
// Railway → data/uploads local (efêmero).
const UPLOAD_DIR = process.env.ADS_UPLOAD_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads')
    : path.join(__dirname, 'data', 'uploads'));

// Origem pública absoluta (https://host) para montar URLs que o TikTok baixa.
// Precedência: PRIMARY_HOST → RAILWAY_PUBLIC_DOMAIN → host do request. Sempre
// https (o TikTok exige) e sem porta.
function publicOrigin(req) {
  const envHost = process.env.PRIMARY_HOST || process.env.RAILWAY_PUBLIC_DOMAIN || '';
  let host = String(envHost || '').trim();
  if (!host && req) {
    host = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '')
      .split(',')[0].trim();
  }
  host = host.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/:\d+$/, '');
  return host ? 'https://' + host : '';
}

// Diretório de uma conta (escopo multi-tenant: uma conta nunca vê arquivos da outra).
function accountDir(accountId) {
  return path.join(UPLOAD_DIR, safeSegment(accountId));
}

// Sanitiza um segmento de caminho (accountId ou nome de arquivo) — nunca deixa
// escapar do diretório (sem '/', '\', '..').
function safeSegment(s) {
  return String(s || '').replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 120) || 'x';
}

// Nome de arquivo seguro em minúsculas (mantém extensão).
function safeName(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 80);
}

// Garante o diretório da conta (mkdir -p) e devolve o caminho.
async function ensureAccountDir(accountId) {
  const dir = accountDir(accountId);
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

module.exports = {
  UPLOAD_DIR,
  publicOrigin,
  accountDir,
  ensureAccountDir,
  safeSegment,
  safeName,
};
