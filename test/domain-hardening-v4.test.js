'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

let pass = 0;
function ok(cond, msg) { assert.ok(cond, msg); pass++; }
function read(name) { return fs.readFileSync(path.join(__dirname, '..', name), 'utf8'); }

const server = read('server.js');
const db = read('db.js');
const config = read('config.js');
const security = read('domain-security.js');
const reconciler = read('domain-reconciler.js');
const bot = read('bot-filter.js');
const types = read('dashboard/lib/types.ts');
const cloakUi = read('dashboard/components/cloak/cloak-config-panel.tsx');
const domainsUi = read('dashboard/components/domains/domains-view.tsx');

// Isolamento multi-tenant e corridas de ownership.
ok(db.includes('async function claimCustomDomain'), 'DB possui claim atômico de domínio');
ok(db.includes('ON CONFLICT (host) DO NOTHING'), 'claim não sobrescreve domínio já reservado');
ok(db.includes('WHERE host = ${host} AND account_id IS NULL'), 'claim adota linha legada sem owner de forma atômica');
ok(db.includes('WHERE custom_domains.account_id IS NULL OR custom_domains.account_id = EXCLUDED.account_id'), 'upsert não altera domínio de outra conta');
ok(server.includes("'domain_owner_conflict'"), 'API expõe conflito de ownership sem sobrescrever');

// Slugs públicos não podem resolver varrendo contas.
const resolveStart = server.indexOf('function resolveCloakEntry');
const resolveEnd = server.indexOf('\n}', resolveStart) + 2;
const resolveFn = server.slice(resolveStart, resolveEnd);
ok(resolveFn.includes('config.accountForCloakSlug'), 'resolução pública de slug usa índice global');
ok(!resolveFn.includes('config.accountIds()'), 'resolução pública de slug não varre todas as contas');
ok(config.includes('cloakSlugOwners.set(slug, null)'), 'slugs legados duplicados ficam ambíguos/fail-closed');

// Verificação forte de domínio + proteção SSRF/DNS rebinding.
ok(server.includes('domainSecurity.verifyDomainProof'), 'verificação exige prova assinada host+conta');
ok(security.includes("err.code = 'unsafe_address'"), 'helper rejeita rede privada/reservada');
ok(security.includes("dns.lookup(h, { all: true, verbatim: true })"), 'resolve todos os endereços antes da conexão');
ok(security.includes('host: chosen.address') && security.includes('servername: host'), 'HTTPS fixa IP resolvido preservando SNI');
ok(!security.includes('followRedirect'), 'probe seguro não habilita redirecionamento automático');
ok(server.includes('out.securityBlocked = true'), 'API diferencia bloqueio de segurança de DNS pendente');
ok(security.includes('DOMAIN_PROOF_SECRET_PREVIOUS'), 'prova de domínio suporta rotação em rolling deploy');

// Provisionamento/reconciliação autônoma.
ok(reconciler.includes('setInterval') && reconciler.includes('90_000'), 'worker de reconciliação roda periodicamente');
ok(reconciler.includes("'pending_ssl' : 'pending_dns'"), 'worker modela etapas DNS/SSL');
ok(reconciler.includes('backoffMs(retryCount)'), 'worker usa retry com backoff');
ok(reconciler.includes('6 * 60 * 60_000'), 'domínios saudáveis continuam sendo reconciliados periodicamente');
ok(server.includes('domainReconciler.start()'), 'servidor inicia reconciliador após boot');
ok(reconciler.includes('function health()') && server.includes('domainAutomation: domainReconciler.health()'), 'health autenticado expõe estado do reconciliador');
ok(db.includes('next_check_at') && db.includes('retry_count'), 'estado operacional do worker é durável');

// Challenge e observabilidade segura.
ok(bot.includes('TRAFFIC_CHALLENGE_SECRET'), 'challenge usa secret dedicado');
ok(bot.includes('TRAFFIC_CHALLENGE_SECRET_PREVIOUS'), 'challenge aceita rotação de secret');
ok(bot.includes('TRAFFIC_CHALLENGE_SECRET é obrigatório em produção'), 'produção falha sem secret de challenge');
ok(server.includes('domainSecurity.assertProductionConfig()'), 'boot valida secret de prova de domínio');
ok(server.includes('botFilter.assertSecurityConfig()'), 'boot valida secret de challenge');
ok(server.includes('SameSite=Lax') && server.includes('Priority=High'), 'cookie do visitante recebe atributos endurecidos');
ok(server.includes("rateLimited(clientIp(req), 'cloakcheck', 120)"), 'endpoint de challenge tem rate-limit por IP');

// Shadow mode existe de ponta a ponta e não promete enforcement.
ok(config.includes('shadowMode') && server.includes('const enforceCloak = cloakOn && !shadowMode'), 'backend separa classificação de enforcement');
ok(server.includes("bumpDecision('offer', 'shadow-score',"), 'shadow mode registra score sem redirecionar');
ok(types.includes('shadowMode?: boolean'), 'contrato TypeScript expõe shadow mode');
ok(cloakUi.includes('Modo observação') && cloakUi.includes('classifica sem alterar o destino'), 'UI permite observação sem enforcement');

// UX de domínio comunica automação em vez de exigir polling mental/manual.
ok(domainsUi.includes('acompanha o DNS') && domainsUi.includes('ativa o HTTPS'), 'UI comunica hospedagem gerenciada e acompanhamento automático');
ok(types.includes('retryCount?: number') && types.includes('nextCheckAt?: string | null'), 'UI conhece estado de retry/reconciliação');

console.log('\n[domain-hardening-v4] ' + pass + ' asserts OK');
