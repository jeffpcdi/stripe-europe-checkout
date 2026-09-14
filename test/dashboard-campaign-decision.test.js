'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const routes = fs.readFileSync('ads-routes.js', 'utf8');
const api = fs.readFileSync('dashboard/lib/api.ts', 'utf8');
const view = fs.readFileSync('dashboard/components/ads/tiktok-ads-view.tsx', 'utf8');
const tree = fs.readFileSync('dashboard/components/ads/campaign-tree.tsx', 'utf8');
const metrics = fs.readFileSync('dashboard/components/ads/campaign-metric-grid.tsx', 'utf8');

assert(routes.includes("app.get('/api/ads/campaign-decisions'"), 'backend deve expor o modelo de decisão por campanha');
assert(routes.includes('buildCampaignDecisions({ attribution, snapshot, pendingProposals })'), 'rota deve unir atribuição e automação no backend');
assert(api.includes('useAdsCampaignDecisions'), 'frontend deve ter hook próprio para o modelo de decisão');
assert(view.includes('useAdsCampaignDecisions(campaignsActive'), 'polling de decisões deve rodar apenas na aba Campanhas');
assert(tree.includes('CPA real') && tree.includes('ROAS real') && tree.includes('Automação'), 'tabela principal deve priorizar métricas reais e automação');
assert(tree.includes('Vendas rastreadas pelo ROINADOS'), 'coluna de vendas deve declarar a origem first-party');
assert(!tree.includes('Mostrar CPC, CPM e cliques'), 'métricas diagnósticas não devem competir com a leitura principal');
assert(metrics.includes('attributionLoaded'), 'detalhe deve distinguir atribuição real carregada de fallback TikTok');

console.log('[OK] dashboard campaigns — decisão real e automação priorizadas na lista principal.');
