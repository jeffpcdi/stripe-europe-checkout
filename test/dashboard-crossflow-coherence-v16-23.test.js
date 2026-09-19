'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const server = read('server.js');
assert.match(server, /app\.post\('\/api\/domains\/:host\/usage'/);
assert.match(server, /domain_usage_in_use/);
assert.match(server, /baseUrl: host \? 'https:\/\/' \+ host : ''/);

const domains = read('dashboard/components/domains/domains-view.tsx');
assert.match(domains, /uso: usage/);
assert.doesNotMatch(domains, /uso: 'ambos'/);
assert.match(domains, /Links de venda/);
assert.match(domains, /value="cloaker">Cloaker/);
assert.match(domains, /\/api\/domains\/\$\{encodeURIComponent\(domain\)\}\/usage/);
assert.match(domains, /<Link href=\{\`\/links\?novo=1&dominio=/);
assert.match(domains, /<Link href=\{\`\/cloak\?novo=1&dominio=/);
assert.doesNotMatch(domains, /<a href=\{\`\/(?:links|cloak)/);

const cloakEditor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
assert.match(cloakEditor, /<Link href="\/domains\?uso=cloaker"/);
assert.doesNotMatch(cloakEditor, /<a href="\/domains"/);

const conversions = read('dashboard/components/conversions/conversions-view.tsx');
assert.match(conversions, /useSearchParams/);
assert.match(conversions, /requestedTab === 'gateways' \|\| requestedTab === 'logs'/);
assert.match(conversions, /router\.replace\(pathname \+ \(query \? `\?\$\{query\}` : ''\), \{ scroll: false \}\)/);
assert.match(conversions, /onClick=\{\(\) => selectTab\('gateways'\)\}/);
assert.match(conversions, /onClick=\{\(\) => selectTab\('logs'\)\}/);

const conversionsPage = read('dashboard/app/(dashboard)/conversions/page.tsx');
assert.match(conversionsPage, /<Suspense>/);

const links = read('dashboard/components/links/links-view.tsx');
assert.match(links, /data\?\.baseUrl/);
assert.doesNotMatch(links, /domainsData\?\.appHost \|\|/);
assert.match(links, /domain\.verificado && \(!domain\.status \|\| domain\.status === 'active'\)/);
assert.match(links, /Destino seguro próprio/);
assert.doesNotMatch(links, />Cloaker ativo</);

const linkEditor = read('dashboard/components/links/link-editor.tsx');
assert.match(linkEditor, /selectedDomainUnavailable/);
assert.match(linkEditor, /não está ativo/);
assert.match(linkEditor, /selectedDomainUnavailable\}/);

const config = read('dashboard/components/cloak/cloak-config-panel.tsx');
assert.match(config, /Proteção dos links de venda/);
assert.match(config, /Observação das campanhas Cloaker/);
assert.match(config, /Não altera os links de venda/);
assert.match(config, /Camadas dos links de venda/);
assert.doesNotMatch(config, /Compatibilidade com o motor legado/);

const account = read('dashboard/components/config/config-view.tsx');
assert.match(account, /Apagar histórico de desempenho/);
assert.match(account, /vendas, falhas, reembolsos e contestações/);

assert.match(server, /const cloakRefs = \[\.\.\.cloakRefsV2, \.\.\.cloakRefsLegacy\]/);

console.log('dashboard-crossflow-coherence-v16-23: domínios, conversões, links e proteção coerentes');
