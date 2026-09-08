'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../ads-provider'), 'utf8');
const code = source.slice(source.indexOf('async function createSmartPlusCampaign('), source.indexOf('// ── Campanha de catálogo (VSA'));
let calls = [], failCover = false;
const context = {
  SMART_PLUS_GOALS: { conversions: { objective: 'WEB_CONVERSIONS', promotion: 'WEBSITE', optimization: 'CONVERT', billing: 'OCPM' } }, TIKTOK_MIN_BUDGET: 50,
  badRequest: message => Error(message), normalizePublicImageUrl: value => value,
  getAdvertiserInfo: async () => ({ timezone: 'America/Sao_Paulo' }), pickAdIdentity: async () => ({ identityId: 'id', identityType: 'BC_AUTH_TT' }),
  resolveLocationIds: async () => ({ locationIds: ['US'], missingCountries: [] }),
  uploadVideoAndWait: async () => { calls.push('video'); return 'video'; },
  getUploadedVideoAsset: async () => { calls.push('cover-read'); if (failCover) throw Error('capa pendente'); return { coverUrl: 'https://cdn.tiktokcdn.com/cover.jpg' }; },
  uploadImage: async (_, url, ids, options) => { calls.push(['image', url, options.tikTokGenerated]); return 'cover'; },
  advertiserLocalTime: () => '2026-09-08 10:00:00', deepPluck: (row, key) => row[key], cacheBust() {},
  pipeboard: { callTool: async (name, args) => { calls.push([name, args]); return { campaign_id: 'campaign', adgroup_id: 'group', ad_id: 'ad' }; } },
};
vm.runInNewContext(code, context);
(async () => {
  const spec = { name: 'Campanha', goal: 'conversions', budgetAmount: 50, endDate: '2099-01-01', videoUrl: 'https://cdn.example/video.mp4', linkUrl: 'https://shop.example/item', pixelId: '12345678', customEventType: 'ON_WEB_ORDER' };
  await context.createSmartPlusCampaign('123', spec);
  assert.equal(calls[0], 'video'); assert.equal(calls[1], 'cover-read');
  assert.equal(calls[2][2], true, 'capa gerada exige CDN do TikTok');
  assert.equal(calls[3][0], 'create_tiktok_smart_plus_campaign', 'assets preparados antes da campanha');
  const asset = calls.find(call => Array.isArray(call) && call[0] === 'create_tiktok_smart_plus_ad');
  assert(asset, 'anúncio criado com a capa');
  calls = []; failCover = true;
  await assert.rejects(context.createSmartPlusCampaign('123', spec), /capa pendente/);
  assert(!calls.some(call => Array.isArray(call) && call[0].startsWith('create_')), 'falha da capa não cria campanha parcial');
  console.log('ads-smart-cover: capa automática e falha antes da campanha OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
