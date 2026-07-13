// Contrato das rotas de domínios personalizados (plano de correção — Bloco B).
// O server.js é monolítico (não bota em teste), então validamos os invariantes
// direto na fonte, no mesmo estilo do route-auth.test.js:
//   1. Seleção de provider é DINÂMICA (activeDomainProvider), nunca congelada.
//   2. As instruções DNS usam o Managed CNAME target — nunca a origem crua.
//   3. Estados persistidos: status/lastCheckedAt/lastError no cadastro e verificação.
//   4. A verificação NUNCA regride 'active' por leitura transitória.
//   5. Endpoint de diagnóstico existe, é autenticado e checa TLS via SNI.
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0;
function ok(cond, msg) {
  if (!cond) { console.error('  ✗ ' + msg); throw new assert.AssertionError({ message: msg }); }
  pass++;
}

const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'cloudflare-domain-provider.js'), 'utf8');

// ── 1. Seleção dinâmica do provider ─────────────────────────────────────────
ok(src.includes('function activeDomainProvider()'), 'server define activeDomainProvider()');
ok(
  !/const domainProvider = cloudflareDomainProvider\.enabled \?/.test(src),
  'a escolha do provider NÃO é congelada no boot (o preflight assíncrono pode desabilitá-lo)'
);
// Cada rota de escrita resolve o provider na hora
const postDomains = src.slice(src.indexOf("app.post('/api/domains'"), src.indexOf("app.delete('/api/domains/:host'"));
const deleteDomains = src.slice(src.indexOf("app.delete('/api/domains/:host'"), src.indexOf("app.post('/api/domains/verify'"));
const verifyRoute = src.slice(src.indexOf("app.post('/api/domains/verify'"), src.indexOf("app.get('/api/custom-domains/:host/diagnostics'"));
ok(postDomains.includes('activeDomainProvider()'), 'POST /api/domains resolve o provider por requisição');
ok(deleteDomains.includes('activeDomainProvider()'), 'DELETE /api/domains/:host resolve o provider por requisição');
ok(verifyRoute.includes('activeDomainProvider()'), 'POST /api/domains/verify resolve o provider por requisição');

// ── 2. CNAME target ≠ origem ────────────────────────────────────────────────
ok(
  src.includes('cloudflareDomainProvider.cnameTarget()'),
  'GET /api/domains usa o Managed CNAME target (não a origem Railway) como appHost'
);
ok(
  !/appHost:\s*cloudflareDomainProvider\.enabled\s*\?\s*String\(process\.env\.CLOUDFLARE_FALLBACK_ORIGIN/.test(src),
  'appHost NÃO expõe mais o CLOUDFLARE_FALLBACK_ORIGIN cru'
);
ok(provider.includes('CLOUDFLARE_CNAME_TARGET'), 'provider conhece CLOUDFLARE_CNAME_TARGET');
ok(
  /cname:\s*\{\s*name:[^}]*target:\s*cnameTarget\(\)/.test(provider),
  'as instruções DNS do provider usam cnameTarget(), nunca a origem direta'
);

// ── 3. Estados persistidos ──────────────────────────────────────────────────
ok(
  /status:\s*providerStatus\s*\|\|\s*'pending_dns'/.test(src),
  'cadastro persiste status inicial (pending_dns por padrão)'
);
ok(postDomains.includes('lastCheckedAt') && postDomains.includes('lastError'), 'cadastro persiste lastCheckedAt/lastError');
ok(verifyRoute.includes('lastCheckedAt'), 'verificação persiste lastCheckedAt');
ok(
  /'pending_dns'|'pending_ssl'|'active'|'error'/.test(provider) && provider.includes('function mapStatus'),
  'provider mapeia os 4 estados explícitos (mapStatus)'
);

// ── 4. Não-regressão de active ──────────────────────────────────────────────
ok(
  /prevStatus === 'active' && st\.status !== 'active' && st\.status !== 'error'/.test(src),
  'verificação nunca regride active por leitura transitória (só com error explícito)'
);
ok(
  /verificado: true, verificadoEm: now, status: 'active'/.test(src),
  'prova forte (HTTPS + marcador) persiste status active junto do espelho legado'
);

// ── 5. Diagnóstico ──────────────────────────────────────────────────────────
ok(
  /app\.get\('\/api\/custom-domains\/:host\/diagnostics',\s*dashboardAuth/.test(src),
  'endpoint de diagnóstico existe e exige sessão (dashboardAuth)'
);
const diagRoute = src.slice(src.indexOf("app.get('/api/custom-domains/:host/diagnostics'"));
const diagEnd = diagRoute.indexOf('// ═══');
const diag = diagRoute.slice(0, diagEnd > 0 ? diagEnd : 5000);
ok(diag.includes('getPeerCertificate'), 'diagnóstico inspeciona o certificado apresentado via SNI');
ok(diag.includes('servername: host'), 'diagnóstico usa SNI do próprio domínio (não da origem)');
ok(diag.includes('__domain-check'), 'diagnóstico testa o marcador HTTP do app');
ok(diag.includes('likelyCause'), 'diagnóstico devolve a causa mais provável para a UI');
ok(!diag.includes('CLOUDFLARE_API_TOKEN'), 'diagnóstico nunca toca no token diretamente');

// ── 6. Preflight do provider ────────────────────────────────────────────────
ok(provider.includes('function runPreflight'), 'provider tem preflight explícito');
ok(provider.includes('function isPublicHostname'), 'provider valida origem pública (rejeita railway.internal)');
ok(provider.includes('function ensureFallbackOrigin'), 'provider sincroniza o fallback origin da zona (idempotente)');
ok(
  /railway\\?\.internal/.test(provider),
  'hosts *.railway.internal são explicitamente rejeitados'
);

console.log('\n[custom-domains-routes] ' + pass + ' asserts OK');
