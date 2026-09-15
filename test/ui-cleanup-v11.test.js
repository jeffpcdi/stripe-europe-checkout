'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', 'dashboard');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

const links = read('components/links/links-view.tsx');
const domains = read('components/domains/domains-view.tsx');
const cloak = read('components/cloak/cloak-view.tsx');
const pixel = read('components/conversions/conversions-view.tsx');
const campaigns = read('components/ads/campaign-tree.tsx');
const automation = read('components/ads/automation-panel.tsx');

assert.doesNotMatch(links, /<h1[^>]*>Links<\/h1>/, 'título Links impresso deve sair');
assert.doesNotMatch(domains, /<h1[^>]*>Domínios<\/h1>/, 'título Domínios impresso deve sair');
assert.doesNotMatch(cloak, /<h1[^>]*>Cloaker<\/h1>/, 'título Cloaker impresso deve sair');
assert.doesNotMatch(pixel, /<h1[^>]*>Pixel<\/h1>/, 'título Pixel impresso deve sair');
assert.doesNotMatch(pixel, />Configuração<\/h2>/, 'card Configuração impresso deve sair');
assert.doesNotMatch(pixel, /1\. Pixel do TikTok|2\. Checkout e webhook|3\. Vinculação|4\. Entrega confirmada/, 'passos do card Configuração devem sair');
assert.doesNotMatch(campaigns, /Compare gasto, vendas reais e automação por campanha/, 'microtexto da lista de campanhas deve sair');
assert.doesNotMatch(automation, /Defina o nível de autonomia e deixe o ROINADOS monitorar/, 'microtexto da automação deve sair');

console.log('ui-cleanup-v11: elementos solicitados removidos');
