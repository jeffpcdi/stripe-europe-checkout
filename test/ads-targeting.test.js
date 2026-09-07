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
const bulkUpload = fs.readFileSync(path.join(__dirname, '..', 'dashboard/components/ads/bulk-upload-dialog.tsx'), 'utf8');
const adsTime = fs.readFileSync(path.join(__dirname, '..', 'dashboard/lib/ads-time.ts'), 'utf8');

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
  ok(/<UniversalLauncherDialog/.test(view) && /onSmartPlus=/.test(view) && /onSpark=/.test(view), 'Nova campanha mantém os formatos acessíveis no lançador');
  ok(/const STEPS = \['Configuração', 'Criativo', 'Revisão'\]/.test(create), 'criador regular usa três etapas');
  ok(!/interestIds|gender|placementMode|pixelId|customEventType/.test(create), 'criador não expõe segmentação e Pixel técnicos');
  ok(/goal: 'conversions'/.test(create), 'criador envia somente conversão');
  ok(/Pixel.*selecionado automaticamente/i.test(create), 'revisão informa o vínculo automático');
  ok(!/GOALS|setGoal|Pixel ID \(numérico\)/.test(spark), 'Spark não oferece objetivos incompatíveis nem Pixel manual');
  ok(/goal: 'conversions'/.test(spark), 'Spark envia conversão');
  ok(!/setGoal|Pixel ID \(numérico\)|TIKTOK_PIXEL_EVENTS/.test(smart), 'Smart+ não oferece tráfego nem Pixel manual');
  ok(/goal: 'conversions'/.test(smart), 'Smart+ envia conversão');
}

console.log('Vídeos em massa — conversão automática e segura');
{
  const bulkRouteStart = routes.indexOf("app.post('/api/ads/bulk'");
  const bulkRouteEnd = routes.indexOf('// Progresso do job', bulkRouteStart);
  const bulkRoute = routes.slice(bulkRouteStart, bulkRouteEnd);
  const bulkExecutor = routes.slice(routes.indexOf('async function processBulkItem'), routes.indexOf('bulk.startBulkWorker'));

  ok(!/AdsGoal|GOALS|setGoal|TIKTOK_PIXEL_EVENTS|customEventType|setPixelId/.test(bulkUpload), 'lote não expõe objetivos incompatíveis nem Pixel/evento manual');
  ok(/goal: 'conversions'/.test(bulkUpload), 'lote envia somente conversão');
  ok(/useAdsTikTokPixels/.test(bulkUpload) && /pixelReady/.test(bulkUpload), 'lote verifica o vínculo central antes do upload');
  ok(/crypto\.randomUUID\(\)/.test(bulkUpload) && /idempotencyRef/.test(bulkUpload), 'retry de timeout preserva uma chave idempotente estável');
  ok(/Página de destino/.test(bulkUpload) && /https:\\\/\\\/\\S\+/.test(bulkUpload), 'lote exige página HTTPS de destino');

  ok(/common\.goal && common\.goal !== 'conversions'/.test(bulkRoute), 'backend recusa objetivo diferente de conversão');
  ok(/requireCampaignPixel\(req\.account\.id, selected\.advertiserId\)/.test(bulkRoute), 'backend resolve o Pixel central pelo advertiser');
  ok(/promotedObject: \{ pixelId: pixel\.pixelId, customEventType: 'ON_WEB_ORDER' \}/.test(bulkRoute), 'backend injeta Pixel central e evento Compra');
  ok(/adAccountId: selected\.advertiserId/.test(bulkRoute), 'tarefas usam o advertiser validado, não o valor cru do navegador');
  ok(/meta: \{ goal: 'conversions'/.test(bulkRoute), 'job durável registra o objetivo real de conversão');
  ok(/status: 'paused'/.test(bulkExecutor), 'executor mantém cada criação pausada');
}

console.log('Período global');
{
  ok(/adsDateRange\(rangeDays, advertiserTimeZone\)/.test(view), 'Campanhas calcula o período no fuso do advertiser');
  ok(/useAdsAttribution\(treeActive, effectiveAdvertiser, \{ fromDate, toDate \}\)/.test(view), 'atribuição acompanha o período global');
  ok(/count - 1/.test(adsTime), 'período diário não inclui o dia anterior');
  ok(/formatToParts/.test(adsTime) && /safeAdsTimeZone/.test(adsTime), 'datas usam um fuso IANA validado, sem UTC implícito');
}

console.log('\nads-targeting: ' + n + ' asserts OK');
