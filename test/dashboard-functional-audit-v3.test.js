'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const server = read('server.js');
const config = read('config.js');
const db = read('db.js');
const linkStore = read('link-store.js');
const stats = read('stats.js');
const metrics = read('dashboard/lib/metrics.ts');
const overview = read('dashboard/components/overview/overview-view.tsx');
const overviewPeriod = read('dashboard/lib/overview-period.tsx');
const funnel = read('dashboard/components/funnel/funnel-view.tsx');
const links = read('dashboard/components/links/links-view.tsx');
const linkEditor = read('dashboard/components/links/link-editor.tsx');
const domains = read('dashboard/components/domains/domains-view.tsx');
const configView = read('dashboard/components/config/config-view.tsx');

console.log('Auditoria funcional V3 — domínios');
assert.match(config, /\['pending_dns', 'pending_ssl', 'active', 'error'\]\.includes\(d\.status\)/,
  'sanitizador deve preservar estado operacional de domínio');
assert.match(config, /out\.lastCheckedAt/,
  'sanitizador deve preservar data da última verificação');
assert.match(config, /out\.lastError/,
  'sanitizador deve preservar erro operacional do domínio');
assert.match(server, /const registeredDomain = \(config\.get\(req\.account\.id\)\.customDomains \|\| \[\]\)\.find\(\(d\) => d\.host === host\)/,
  'verificação de domínio deve exigir cadastro na conta atual');
assert.match(server, /domain_not_found[\s\S]{0,180}Adicione o domínio nesta conta antes de verificar/,
  'verificação não pode reivindicar host arbitrário');
assert.match(server, /const checkoutRefs = linkStore\.list\(req\.account\.id\)/,
  'remoção de domínio deve checar links de checkout');
assert.match(server, /const cloakRefsLegacy = \(config\.get\(req\.account\.id\)\.cloakLinks \|\| \[\]\)/,
  'remoção de domínio deve checar referências legadas do Cloaker');
assert.match(server, /const cloakRefsV2 = cloakCampaignStore\.isReady\(\)/,
  'remoção de domínio deve checar campanhas V2 do Cloaker');
assert.match(server, /const cloakRefs = \[\.\.\.cloakRefsV2, \.\.\.cloakRefsLegacy\]/,
  'remoção de domínio deve considerar V1 e V2 simultaneamente durante a migração');
assert.match(server, /'domain_in_use'/,
  'domínio em uso deve ser bloqueado em vez de gerar referência órfã');
assert.match(server, /status, lastCheckedAt: now/,
  'tentativas pendentes de verificação devem sobreviver ao refresh');
assert.match(domains, /error instanceof ApiError\) return error\.display/,
  'UI de domínio deve exibir hint acionável do backend');

console.log('Auditoria funcional V3 — links');
assert.match(server, /const accountDomains = config\.get\(req\.account\.id\)\.customDomains \|\| \[\]/,
  'salvar link valida domínio dentro da conta');
assert.match(server, /link_domain_wrong_usage/,
  'domínio exclusivo do cloak não pode ser usado como domínio de checkout');
const persistPos = linkStore.indexOf('const durable = existing && existing.slug !== slug');
const cachePos = linkStore.indexOf("const idx = cache.findIndex((l) => l.slug === slug && l.acc === accountId)");
assert(persistPos >= 0 && cachePos > persistPos, 'save de link deve persistir antes de alterar cache');
const deletePersistPos = linkStore.indexOf('const durable = await db.deleteLink(accountId, slug)');
const deleteCachePos = linkStore.indexOf("cache = cache.filter((l) => !(l.slug === slug && l.acc === accountId))");
assert(deletePersistPos >= 0 && deleteCachePos > deletePersistPos, 'delete de link deve persistir antes de alterar cache');
assert.match(server, /err\.code === 'persistence_failed' \? 503/,
  'falha de persistência de link deve ser 503, não erro de formulário');
assert.match(db, /ON CONFLICT \(slug\) DO UPDATE SET account_id = EXCLUDED\.account_id/,
  'upsert de link deve manter ownership persistido coerente');
assert.doesNotMatch(linkEditor, /escudoMaximo|Escudo Máximo Ativo/,
  'editor não deve exibir switch que não possui contrato backend');
assert.match(linkEditor, /paises: link\?\.paises \?\? \[\]/,
  'editor deve preservar países ocultos em edição');
assert.match(linkEditor, /idiomas: link\?\.idiomas \?\? \[\]/,
  'editor deve preservar idiomas ocultos em edição');
assert.match(linkEditor, /pixelSlug: link\?\.pixelSlug \?\? ''/,
  'editor deve preservar pixel oculto em edição');
assert.match(linkEditor, /urlWhitePage: variant\.urlWhitePage \|\| null/,
  'editor deve preservar white page por variante quando não há campo visual para ela');
assert.match(links, /const checkoutDomains = \(domainsData\?\.domains \?\? \[\]\)\.filter\(\(domain\) =>[\s\S]{0,180}\(domain\.uso \?\? 'ambos'\) !== 'cloaker'/,
  'editor deve excluir domínios dedicados ao Cloaker');
assert.match(links, /domainReady\(domain\) \|\| domain\.host === editing\?\.dominio/,
  'editor deve exigir domínio pronto sem apagar o domínio existente durante edição');
assert.match(links, /window\.location\.host/,
  'URL pública deve ter fallback real enquanto /api/domains carrega');
assert.match(links, /\[qrFor, appHost, links\]/,
  'QR deve reagir a edições do link, não ficar com URL em cache');
assert.match(links, /experiment: l\.experiment \? \{/,
  'duplicar link deve preservar configuração do experimento existente');

console.log('Auditoria funcional V3 — período e visão geral');
assert.match(metrics, /periodStart\(period: Period, now = new Date\(\), timeZone: string = APP_TIME_ZONE\)/,
  'corte de período deve aceitar o fuso configurado');
assert.match(metrics, /aggregate\([\s\S]{0,160}timeZone: string = APP_TIME_ZONE/,
  'agregação deve usar o fuso da conta');
assert.match(overview, /useAccountSettings\(afterFirstPaint\)/,
  'Visão Geral deve ler o fuso da conta');
assert.match(overviewPeriod, /localStorage\.getItem\(PERIOD_KEY\)/,
  'provider global deve restaurar o período persistido');
assert.match(overview, /useOverviewPeriod\(\)/,
  'Visão Geral deve consumir o período universal do provider');
assert.match(overview, /useAdsCampaignDecisions/,
  'top campanhas deve usar o mesmo modelo first-party da aba Campanhas');
assert.match(overview, /const sales = decision \? Number\(decision\.sales\)/,
  'vendas do destaque devem vir da decisão first-party');
assert.match(overview, /roas\?\.currency \|\| adsStatus\?\.currency/,
  'ROAS real só deve comparar receita com a moeda real do gasto');
assert.match(funnel, /periodStart\(period, now, accountTimeZone\)/,
  'Funil deve respeitar o mesmo fuso da conta');

console.log('Auditoria funcional V3 — configurações e cache');
assert.match(server, /app\.post\('\/api\/settings', dashboardAuth, async \(req, res\) =>/,
  'salvamento de preferências deve aceitar patch unificado');
assert.doesNotMatch(server, /if \(hasExtra && !body\.defaultCurrency\)/,
  'moeda e outras preferências não podem ser ramos mutuamente exclusivos');
assert.match(server, /res\.json\(Object\.assign\(\{ ok: true, settings: saved \}, accountSettingsPayload/,
  'POST settings deve devolver o estado normalizado final');
assert.match(configView, /useSWRConfig/,
  'reset deve poder invalidar caches compartilhados');
assert.match(configView, /mutateCache\('\/api\/stats'\)/,
  'reset deve atualizar imediatamente telas que usam stats');
assert.match(configView, /mutateCache\('\/api\/overview\/health'\)/,
  'reset deve atualizar imediatamente saúde da visão geral');
const statsPersistPos = stats.indexOf('const durable = await db.reset(accountId)');
const statsMemoryPos = stats.indexOf("state.leads = (state.leads || []).filter((l) => l.acc !== accountId)");
assert(statsPersistPos >= 0 && statsMemoryPos > statsPersistPos,
  'reset deve confirmar banco antes de limpar o cache em memória');
assert.match(server, /const ok = await stats\.reset\(req\.account\.id\)[\s\S]{0,180}reset_persistence_failed/,
  'endpoint de reset deve falhar se a exclusão durável falhar');

console.log('dashboard-functional-audit-v3: OK');
