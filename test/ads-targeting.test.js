'use strict';
/*
 * Parte A — direcionamento na criação: gênero, interesses e posicionamento.
 * O buildCreatePayload (fechado em ads-routes) normaliza os campos novos e o
 * createFullAd os injeta no targeting/ad group do TikTok. buildCreatePayload não
 * é exportado (closure), então validamos por leitura de fonte, no mesmo estilo
 * das outras suítes de rota (ads-automation-cpc, ads-smart-plus).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(cond, label) { assert.ok(cond, label); n++; console.log('  ✓ ' + label); }

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
const internals = require('../ads-provider')._internals;

console.log('buildCreatePayload — normaliza gênero/interesses/posicionamento');
{
  const body = (routes.match(/function buildCreatePayload[\s\S]*?return \{ payload \};/) || [''])[0];
  ok(/b\.gender === 'male' \|\| b\.gender === 'female'/.test(body), 'gênero: só male/female (all/ausente não segmenta)');
  ok(/interestIds[\s\S]{0,200}\/\^\\d\{1,20\}\$\//.test(body), 'interesses: só IDs numéricos');
  ok(/slice\(0, 20\)/.test(body), 'interesses: cap de 20');
  ok(/PLACEMENT_TIKTOK.*PLACEMENT_PANGLE|ALLOWED = \[/.test(body), 'posicionamento: whitelist de valores');
  ok(/payload\.placements/.test(body) && /payload\.gender/.test(body) && /payload\.interestIds/.test(body), 'os 3 campos entram no payload');
}

console.log('createFullAd — injeta no targeting/ad group do TikTok');
{
  const body = (provider.match(/async function createFullAd[\s\S]*?\n}\n/) || [''])[0];
  ok(/targeting\.gender = 'GENDER_MALE'/.test(body), 'gênero → GENDER_MALE');
  ok(/targeting\.gender = 'GENDER_FEMALE'/.test(body), 'gênero → GENDER_FEMALE');
  ok(/targeting\.interest_category_ids = s\.interestIds/.test(body), 'interesses → interest_category_ids');
  ok(/placement_type = 'PLACEMENT_TYPE_NORMAL'/.test(body), 'posicionamento específico → PLACEMENT_TYPE_NORMAL + placements');
  ok(/placement_type = 'PLACEMENT_TYPE_AUTOMATIC'/.test(body), 'default = automático');
  // retrocompat: campos só entram quando presentes
  ok(/if \(Array\.isArray\(s\.interestIds\) && s\.interestIds\.length\)/.test(body), 'interesses são opcionais (retrocompatível)');
}

console.log('Rota de criação — preserva o targeting validado');
{
  const body = (routes.match(/app\.post\('\/api\/ads\/create'[\s\S]*?app\.get\('\/api\/ads\/spark\/identities'/) || [''])[0];
  ok(/gender: payload\.gender/.test(body), 'rota repassa gênero ao provider');
  ok(/interestIds: payload\.interestIds/.test(body), 'rota repassa interesses ao provider');
  ok(/placements: payload\.placements/.test(body), 'rota repassa posicionamentos ao provider');
  ok(/gender: p\.gender, interestIds: p\.interestIds, placements: p\.placements/.test(routes), 'worker do bulk preserva a segmentação validada');
  ok(/payload\.gender = p\.gender/.test(routes), 'templates preservam gênero');
  ok(/payload\.interestIds = p\.interestIds/.test(routes), 'templates preservam interesses');
  ok(/payload\.placements = p\.placements/.test(routes), 'templates preservam posicionamentos');
  ok(/prepareManualCampaign/.test(body) && /requireAdvertiser/.test(routes), 'preflight e criação validam o advertiser autorizado');
  ok(/\/api\/ads\/create\/preflight/.test(routes), 'preflight manual existe antes da escrita');
}

console.log('Respostas MCP e contratos de conversão');
{
  const nested = {
    advertiser_id: '123',
    interest_categories: { interest_categories: [{ interest_category_id: '9', interest_category_name: 'Compras' }] },
  };
  const rows = internals.firstArray(nested, ['interest_categories', 'list', 'data']);
  ok(rows.length === 1 && rows[0].interest_category_id === '9', 'desembrulha interest_categories repetido pelo MCP');
  ok(internals.firstArray([{ id: 1 }], ['data']).length === 1, 'aceita array na raiz');
  const scheduled = internals.advertiserLocalTime('UTC');
  const delta = new Date(scheduled.replace(' ', 'T') + 'Z').getTime() - Date.now();
  ok(delta >= 40 * 60 * 1000, 'agenda a criação com margem superior aos 30 minutos do TikTok');
  const createBody = (routes.match(/function buildCreatePayload[\s\S]*?return \{ payload \};/) || [''])[0];
  ok(/goal === 'conversions' \|\| goal === 'lead_generation'/.test(createBody), 'Conversões e Leads exigem Pixel no backend');
  ok(/PIXEL_EVENTS/.test(createBody) && /customEventType: evt/.test(createBody), 'evento do Pixel usa allowlist e é obrigatório');
  ok(/Objetivo Leads exige a URL HTTPS/.test(createBody), 'Leads exige página de captura no site');
}

console.log('Período global — uma única fonte para métricas e atribuição');
{
  const view = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/tiktok-ads-view.tsx'), 'utf8');
  const today = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/today-panel.tsx'), 'utf8');
  ok(/Math\.max\(0, rangeDays - 1\)/.test(view), 'Hoje não inclui o dia anterior por erro inclusivo');
  ok(/useAdsAttribution\(treeActive, effectiveAdvertiser, \{ fromDate, toDate \}\)/.test(view), 'atribuição acompanha o período global');
  ok(/<RoasCard[^>]*fromDate=\{fromDate\}[^>]*toDate=\{toDate\}/.test(today), 'ROAS acompanha o período global');
  ok(/toLocalIsoDate/.test(view), 'datas usam o fuso local do operador');
}

console.log('\nads-targeting: ' + n + ' asserts OK');
