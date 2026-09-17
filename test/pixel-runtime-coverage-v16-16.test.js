'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  DEFAULT_WINDOW_DAYS,
  normalizeHost,
  normalizeHits,
  aggregateHotCache,
  normalizeDurableCoverage,
  installationVerdict,
  resolveRuntimeCoverage,
} = require('../pixel-runtime-coverage');

const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

(function hostNormalization() {
  assert.equal(normalizeHost('  WWW.Loja.COM.  '), 'loja.com');
  assert.equal(normalizeHost('checkout.loja.com.'), 'checkout.loja.com');
  assert.notEqual(normalizeHost('checkout.loja.com'), normalizeHost('loja.com'));
  assert.equal(DEFAULT_WINDOW_DAYS, 365);
})();

(function hitsContract() {
  assert.equal(normalizeHits(8), 8);
  assert.equal(normalizeHits('8'), 8);
  assert.equal(normalizeHits(0), 1);
  assert.equal(normalizeHits(-2), 1);
  assert.equal(normalizeHits('invalido'), 1);
})();

(function modernSitesWinOverLegacyAndAggregate() {
  const rows = aggregateHotCache([
    {
      id: 'lead-modern',
      pixelSlug: 'pixel-a',
      site: 'legacy-nao-deve-duplicar.com',
      lastSeen: '2026-09-16T12:00:00.000Z',
      sites: [
        { host: 'WWW.Loja.COM.', lastAt: '2026-09-15T10:00:00.000Z', hits: 8 },
        { host: 'checkout.loja.com', lastAt: '2026-09-16T11:00:00.000Z', hits: 2 },
      ],
    },
    {
      id: 'lead-invalid-date',
      pixelSlug: 'pixel-a',
      lastSeen: '2026-09-17T09:00:00.000Z',
      sites: [{ host: 'loja.com', lastAt: 'data-invalida', hits: 'ruim' }],
    },
    {
      id: 'lead-b',
      pixelSlug: 'pixel-b',
      site: 'www.outro.com.',
      lastSeen: '2026-09-14T08:00:00.000Z',
    },
  ]);

  assert.equal(rows.length, 2);
  const a = rows.find((row) => row.pixelSlug === 'pixel-a');
  assert.ok(a);
  assert.equal(a.visits, 11, 'hits reais somam 8 + 2 + fallback mínimo 1');
  assert.equal(a.lastBrowserAt, '2026-09-16T11:00:00.000Z', 'sites[].lastAt válido tem prioridade global sobre lead.lastSeen');
  assert.deepEqual(a.domains.map((d) => d.host).sort(), ['checkout.loja.com', 'loja.com']);
  assert.equal(a.domains.some((d) => d.host.includes('legacy-nao-deve-duplicar')), false);

  const b = rows.find((row) => row.pixelSlug === 'pixel-b');
  assert.equal(b.domains[0].host, 'outro.com');
  assert.equal(b.domains[0].hits, 1);
})();

(function filtersAreExactPerPixelAndHost() {
  const rows = aggregateHotCache([
    { pixelSlug: 'pixel-a', site: 'www.loja.com', lastSeen: '2026-09-16T10:00:00.000Z' },
    { pixelSlug: 'pixel-a', site: 'checkout.loja.com', lastSeen: '2026-09-16T11:00:00.000Z' },
    { pixelSlug: 'pixel-b', site: 'loja.com', lastSeen: '2026-09-16T12:00:00.000Z' },
  ], { pixelSlug: 'pixel-a', host: 'WWW.LOJA.COM.' });

  assert.equal(rows.length, 1);
  assert.equal(rows[0].pixelSlug, 'pixel-a');
  assert.deepEqual(rows[0].domains.map((d) => d.host), ['loja.com']);
})();

(function durableRowsStayCompactAndRespectPriority() {
  const rows = normalizeDurableCoverage([
    {
      pixel_slug: 'pixel-a',
      host: 'www.loja.com.',
      hits: '8',
      last_at: '2026-09-16T10:00:00.000Z',
      last_seen_at: '2026-09-17T10:00:00.000Z',
      updated_at: '2026-09-17T11:00:00.000Z',
      created_at: '2026-09-01T00:00:00.000Z',
    },
    {
      pixel_slug: 'pixel-a',
      host: 'loja.com',
      hits: 2,
      last_at: null,
      last_seen_at: '2026-09-17T12:00:00.000Z',
      updated_at: '2026-09-17T13:00:00.000Z',
      created_at: '2026-09-02T00:00:00.000Z',
    },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].visits, 10);
  assert.equal(rows[0].domains[0].hits, 10);
  assert.equal(rows[0].lastBrowserAt, '2026-09-16T10:00:00.000Z', 'site.lastAt válido tem prioridade sobre lead.lastSeen/updated_at');
})();

(function durableWinsAfterPruneAndRestart() {
  const durable = {
    ok: true,
    data: [{
      pixelSlug: 'pixel-a',
      lastBrowserAt: '2026-09-17T10:00:00.000Z',
      visits: 12,
      domains: [{ host: 'loja.com', hits: 12, lastAt: '2026-09-17T10:00:00.000Z' }],
    }],
  };

  const afterRestart = resolveRuntimeCoverage(durable, [], {});
  assert.equal(afterRestart.runtimeSource, 'neon');
  assert.equal(afterRestart.runtimeCoverageComplete, true);
  assert.equal(afterRestart.data[0].visits, 12);

  const prunedHotCache = resolveRuntimeCoverage(durable, [
    { pixelSlug: 'pixel-outro', site: 'loja.com', lastSeen: '2026-09-17T11:00:00.000Z' },
  ], {});
  assert.equal(prunedHotCache.data.length, 1);
  assert.equal(prunedHotCache.data[0].pixelSlug, 'pixel-a', 'cache podado não substitui a verdade do Neon');
})();

(function unavailableNeonUsesExplicitDegradedFallback() {
  const withFallback = resolveRuntimeCoverage(
    { ok: false, data: [], error: 'neon_query_failed' },
    [{ pixelSlug: 'pixel-a', site: 'loja.com', lastSeen: '2026-09-17T10:00:00.000Z' }],
    { host: 'loja.com' },
  );
  assert.equal(withFallback.runtimeSource, 'hot-cache-fallback');
  assert.equal(withFallback.runtimeCoverageComplete, false);
  assert.equal(withFallback.data[0].visits, 1);

  const emptyFallback = resolveRuntimeCoverage(
    { ok: false, data: [], error: 'neon_query_failed' },
    [],
    { host: 'loja.com' },
  );
  assert.equal(emptyFallback.runtimeCoverageComplete, false);
  assert.deepEqual(emptyFallback.data, []);
})();

(function gtmSpaAndUnknownVerdicts() {
  const durableRuntime = { pixelSlug: 'pixel-a', visits: 3 };
  assert.deepEqual(
    installationVerdict(false, durableRuntime, true),
    { runtimeSeen: true, runtimeState: 'seen', instalado: true },
    'GTM/SPA sem snippet está instalado quando Neon comprova execução',
  );
  assert.deepEqual(
    installationVerdict(false, null, true),
    { runtimeSeen: false, runtimeState: 'not_seen', instalado: false },
    'sem HTML e sem execução, com cobertura completa, pode concluir não instalado',
  );
  assert.deepEqual(
    installationVerdict(false, null, false),
    { runtimeSeen: false, runtimeState: 'unknown', instalado: null },
    'Neon indisponível + cache vazio precisa ser inconclusivo',
  );
  assert.equal(installationVerdict(true, null, false).instalado, true, 'prova estática continua suficiente mesmo no degradado');
})();

(function durableQueryContractIsTenantScopedAndCompact() {
  const db = read('db.js');
  const start = db.indexOf('async function readPixelRuntimeCoverage');
  const end = db.indexOf('// Risco 7:', start);
  assert.ok(start >= 0 && end > start, 'função durável especializada existe');
  const block = db.slice(start, end);

  assert.match(block, /WHERE account_id = \$\{accountId\}/, 'query é estritamente escopada por account_id');
  assert.match(block, /updated_at >= now\(\)/, 'janela usa atividade recente, não apenas criação');
  assert.match(block, /data->>'pixelSlug'/, 'pixelSlug é filtrável na própria query');
  assert.match(block, /normalizedHost/, 'host normalizado é filtrável na própria query');
  assert.match(block, /jsonb_array_elements/, 'sites modernos são expandidos no PostgreSQL');
  assert.match(block, /jsonb_build_array\(jsonb_build_object\('host', l\.data->>'site'/, 'formato legado é suportado');
  assert.match(block, /SUM\(hits\)/, 'hits são agregados no PostgreSQL');
  assert.match(block, /GROUP BY pixel_slug, host/, 'resultado volta compacto por pixel+host');
  assert.doesNotMatch(block, /SELECT \* FROM leads/, 'não carrega leads completos para o Node');
  assert.doesNotMatch(block, /CREATE INDEX|USING GIN/, 'P2 não cria índice especulativo sem EXPLAIN');
})();

(function serverUsesNeonFirstAndKeepsHardening() {
  const server = read('server.js');
  assert.match(server, /db\.readPixelRuntimeCoverage\(accountId/, 'runtime consulta Neon diretamente');
  assert.match(server, /durable && durable\.ok === true[\s\S]*\? \[\][\s\S]*stats\.getStats\(accountId\)/, 'hot cache só entra quando Neon falha');
  assert.match(server, /runtimeCoverageComplete/, 'contrato expõe completude');
  assert.match(server, /runtimeSource/, 'contrato expõe fonte');
  assert.match(server, /runtimeState:[\s\S]*unknown/, 'verify-url representa indisponibilidade sem falso negativo');
  assert.match(server, /status = 'indisponivel'/, 'health não usa sem_dados quando a cobertura está incompleta');
  assert.match(server, /const VERIFY_TIMEOUT_MS\s*=\s*8000/, 'timeout SSRF permanece');
  assert.match(server, /const VERIFY_MAX_BYTES\s*=\s*1\.5 \* 1024 \* 1024/, 'byte limit permanece');
  assert.match(server, /const VERIFY_MAX_REDIRECTS\s*=\s*1/, 'limite de redirect permanece');
  assert.match(server, /await hostSeguro\(u\.hostname\)/, 'validação de host/DNS permanece');
  assert.match(server, /content-type/, 'validação de content type permanece');
  assert.match(server, /rateLimited\('verify-url\|'/, 'rate limit permanece');
})();

(function uiExplainsUnknownInsteadOfSayingNotInstalled() {
  const install = read('dashboard/components/conversions/install-check.tsx');
  const card = read('dashboard/components/conversions/pixel-card.tsx');
  const types = read('dashboard/lib/types.ts');
  assert.match(install, /runtimeState === 'unknown'/);
  assert.match(install, /verificação ficou inconclusiva/);
  assert.match(card, /Histórico indisponível/);
  assert.match(types, /'hot-cache-fallback'/);
  assert.match(types, /'indisponivel'/);
  assert.match(types, /instalado: boolean \| null/);
})();

console.log('Pixel runtime coverage V16.16 — contrato durável OK');
