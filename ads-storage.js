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
const net = require('net');
const path = require('path');

// Diretório raiz dos uploads. Precedência: ADS_UPLOAD_DIR explícito → Volume do
// Railway → data/uploads local (efêmero).
const UPLOAD_DIR = process.env.ADS_UPLOAD_DIR
  || (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'uploads')
    : path.join(__dirname, 'data', 'uploads'));

function isPublicDownloadHostname(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
    || host.endsWith('.internal') || host.endsWith('.lan')) return false;
  const ipType = net.isIP(host);
  if (ipType === 4) {
    const parts = host.split('.').map(Number);
    return !(parts[0] === 0 || parts[0] === 10 || parts[0] === 127
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 168));
  }
  if (ipType === 6) {
    return !(host === '::' || host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host));
  }
  return host.includes('.') && /^[a-z0-9.-]+$/.test(host);
}

// Origem pública absoluta (https://host) para montar URLs que o TikTok baixa.
// Precedência: PRIMARY_HOST → RAILWAY_PUBLIC_DOMAIN → host do request. Nunca
// transforma localhost/host privado em URL pública: uma operação real precisa
// falhar antes do upload, não entregar ao TikTok um feed impossível de baixar.
function publicOrigin(req) {
  const envHost = process.env.PRIMARY_HOST || process.env.RAILWAY_PUBLIC_DOMAIN || '';
  let raw = String(envHost || '').trim();
  if (!raw && req) {
    raw = String((req.headers && (req.headers['x-forwarded-host'] || req.headers.host)) || '')
      .split(',')[0].trim();
  }
  if (!raw) return '';
  try {
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (!isPublicDownloadHostname(parsed.hostname)) return '';
    return 'https://' + parsed.hostname;
  } catch (_) {
    return '';
  }
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
  isPublicDownloadHostname,
};
