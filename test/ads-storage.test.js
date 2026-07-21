'use strict';
/*
 * Remoção do Vercel Blob: uploads de criativo vão para disco (Volume do Railway)
 * e o feed do catálogo é servido pelo próprio app a partir do Neon. Este teste
 * cobre o módulo ads-storage (origem pública, dir de upload, sanitização) e
 * garante, por leitura de fonte, que o @vercel/blob saiu e as rotas públicas
 * novas existem.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }
function eq(a, b, label) { assert.strictEqual(a, b, label + ' → esperado ' + b + ', veio ' + a); n++; console.log('  ✓ ' + label); }

function freshStorage(env) {
  const keys = ['ADS_UPLOAD_DIR', 'RAILWAY_VOLUME_MOUNT_PATH', 'PRIMARY_HOST', 'RAILWAY_PUBLIC_DOMAIN'];
  const saved = {};
  for (const k of keys) { saved[k] = process.env[k]; delete process.env[k]; }
  Object.assign(process.env, env || {});
  delete require.cache[require.resolve('../ads-storage')];
  const mod = require('../ads-storage');
  // restaura
  for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  return mod;
}

console.log('ads-storage — publicOrigin');
{
  const storage = require('../ads-storage'); // publicOrigin lê env em tempo de chamada
  const keys = ['PRIMARY_HOST', 'RAILWAY_PUBLIC_DOMAIN'];
  const saved = {}; for (const k of keys) saved[k] = process.env[k];
  const setEnv = (env) => { for (const k of keys) delete process.env[k]; Object.assign(process.env, env); };
  const restore = () => { for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } };

  setEnv({ PRIMARY_HOST: 'roi-nados.top' });
  eq(storage.publicOrigin({ headers: {} }), 'https://roi-nados.top', 'PRIMARY_HOST vira origem https');
  setEnv({ RAILWAY_PUBLIC_DOMAIN: 'app.up.railway.app' });
  eq(storage.publicOrigin({ headers: {} }), 'https://app.up.railway.app', 'cai para RAILWAY_PUBLIC_DOMAIN');
  setEnv({});
  eq(storage.publicOrigin({ headers: { host: 'meu-host.com:3000' } }), 'https://meu-host.com', 'fallback do header host (porta removida)');
  eq(storage.publicOrigin({ headers: {} }), '', 'sem host = origem vazia (rota avisa)');
  setEnv({ PRIMARY_HOST: 'https://roi-nados.top/' });
  eq(storage.publicOrigin({ headers: {} }), 'https://roi-nados.top', 'normaliza proto/barra extra no env');
  restore();
}

console.log('ads-storage — UPLOAD_DIR');
{
  eq(freshStorage({ ADS_UPLOAD_DIR: '/mnt/custom' }).UPLOAD_DIR, '/mnt/custom', 'ADS_UPLOAD_DIR explícito vence');
  eq(freshStorage({ RAILWAY_VOLUME_MOUNT_PATH: '/data' }).UPLOAD_DIR, path.join('/data', 'uploads'), 'usa o volume do Railway quando presente');
  ok(/data[\\/]+uploads$/.test(freshStorage({}).UPLOAD_DIR), 'sem env cai em <raiz>/data/uploads (efêmero)');
}

console.log('ads-storage — sanitização de caminho');
{
  const s = freshStorage({});
  ok(!s.safeSegment('../../etc/passwd').includes('/'), 'safeSegment remove barras (sem path traversal)');
  ok(!s.safeSegment('a/b\\c').includes('\\'), 'safeSegment remove backslash');
  eq(s.safeName('Meu Vídeo (final).MP4'), 'meu-v-deo--final-.mp4', 'safeName minúsculo e sem espaços/paren');
}

console.log('ads-catalog-store — feed token exportado');
{
  const store = require('../ads-catalog-store');
  ok(typeof store.getCatalogByFeedToken === 'function', 'getCatalogByFeedToken exportada');
  ok(typeof store.ensureFeedToken === 'function', 'ensureFeedToken exportada');
  ok(typeof store.saveFeedSnapshot === 'function', 'saveFeedSnapshot exportada');
  ok(typeof store.getFeedSnapshot === 'function', 'getFeedSnapshot exportada');
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-catalog-store.js'), 'utf8');
  ok(/ADD COLUMN IF NOT EXISTS feed_token/.test(src), 'migração cria a coluna feed_token');
  ok(/CREATE TABLE IF NOT EXISTS ads_catalog_feed_snapshots/.test(src), 'migração cria snapshots imutáveis do feed');
  ok(/NOT EXISTS[\s\S]*ads_catalog_sync_runs[\s\S]*feedRevision/.test(src), 'limpeza preserva snapshots referenciados por runs duráveis');
}

console.log('Sem Vercel Blob + rotas públicas novas');
{
  const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  ok(!/require\('@vercel\/blob'\)/.test(routes), "ads-routes não faz mais require('@vercel/blob')");
  ok(!/BLOB_READ_WRITE_TOKEN/.test(routes), 'ads-routes não checa mais BLOB_READ_WRITE_TOKEN');
  ok(/adsStorage\.publicOrigin\(req\)/.test(routes), 'upload/feed usam publicOrigin');
  ok(/ensureFeedToken/.test(routes), 'publishCatalogFeed usa o feed_token do app');
  ok(/saveFeedSnapshot/.test(routes) && /feedRevision/.test(routes), 'publica URL versionada ligada ao snapshot CSV');
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  ok(!pkg.dependencies['@vercel/blob'], '@vercel/blob removido das dependências');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  ok(/app\.get\('\/feed\/:token\.csv'/.test(server), 'rota pública GET /feed/:token.csv registrada');
  ok(/getFeedSnapshot/.test(server) && /Cache-Control', 'no-store'/.test(server), 'feed versionado não serve estado mutável nem cache antigo');
  ok(/express\.static\(require\('\.\/ads-storage'\)\.UPLOAD_DIR/.test(server), '/uploads servido estaticamente do UPLOAD_DIR');
  ok(/'\/uploads\/', '\/feed\/'/.test(server) || /\/uploads\/[\s\S]{0,20}\/feed\//.test(server), '/uploads/ e /feed/ no allowlist do guard');
}

console.log('\nads-storage: ' + n + ' asserts OK');
