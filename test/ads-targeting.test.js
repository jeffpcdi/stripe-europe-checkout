'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let n = 0;
function ok(condition, label) { assert.ok(condition, label); n += 1; console.log('  ✓ ' + label); }

const routes = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
const provider = fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8');
const view = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/tiktok-ads-view.tsx'), 'utf8');
const create = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/create-ad-panel.tsx'), 'utf8');
const spark = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/spark-ad-dialog.tsx'), 'utf8');
const smart = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/smart-plus-create-dialog.tsx'), 'utf8');

console.log('Criação TikTok Ads — produto focado em conversão');
{
  const body = (routes.match(/function buildCreatePayload[\s\S]*?return \{ payload \};/) || [''])[0];
  ok(/b\.goal && b\.goal !== 'conversions'/.test(body), 'backend rejeita objetivos fora de conversão');
  ok(/const goal = 'conversions'/.test(body), 'backend fixa o objetivo de conversão');
  ok(/payload\.placements = \['PLACEMENT_TIKTOK'\]/.test(body), 'backend fixa o posicionamento no TikTok');
  ok(/customEventType: 'ON_WEB_ORDER'/.test(body), 'backend fixa o evento Compra');
  ok(/requireCampaignPixel/.test(routes) && /prepareManualCampaign/.test(routes), 'Pixel é resolvido antes da validação da campanha');
  ok(/listTikTokPixels/.test(provider), 'provider lista Pixels autenticados da conta');
}

console.log('Interface — uma entrada, três áreas e configuração automática');
{
  ok(/type TabKey = 'campaigns' \| 'automation' \| 'catalog'/.test(view), 'TikTok Ads tem somente três subabas operacionais');
  ok(!/TodayPanel|SmartPlusPanel|campaignsView/.test(view), 'abas redundantes Hoje e Manuais/Smart+ foram removidas');
  ok(/Conversão ABO\/CBO/.test(view) && /Smart\+/.test(view) && /Spark Ads/.test(view), 'Nova campanha concentra os tipos úteis');
  ok(/const STEPS = \['Configuração', 'Criativo', 'Revisão'\]/.test(create), 'criador regular usa três etapas');
  ok(!/interestIds|gender|placementMode|pixelId|customEventType/.test(create), 'criador não expõe segmentação e Pixel técnicos');
  ok(/goal: 'conversions'/.test(create), 'criador envia somente conversão');
  ok(/Pixel.*selecionado automaticamente/i.test(create), 'revisão informa o vínculo automático');
  ok(!/GOALS|setGoal|Pixel ID \(numérico\)/.test(spark), 'Spark não oferece objetivos incompatíveis nem Pixel manual');
  ok(/goal: 'conversions'/.test(spark), 'Spark envia conversão');
  ok(!/setGoal|Pixel ID \(numérico\)|TIKTOK_PIXEL_EVENTS/.test(smart), 'Smart+ não oferece tráfego nem Pixel manual');
  ok(/goal: 'conversions'/.test(smart), 'Smart+ envia conversão');
}

console.log('Período global');
{
  ok(/Math\.max\(0, rangeDays - 1\)/.test(view), 'período diário não inclui o dia anterior');
  ok(/useAdsAttribution\(treeActive, effectiveAdvertiser, \{ fromDate, toDate \}\)/.test(view), 'atribuição acompanha o período global');
  ok(/toLocalIsoDate/.test(view), 'datas usam o fuso local do operador');
}

console.log('\nads-targeting: ' + n + ' asserts OK');
