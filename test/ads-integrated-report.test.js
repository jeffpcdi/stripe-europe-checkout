'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const mcp = require('../pipeboard-mcp');

const calls = [];
mcp.callTool = async (name, args) => {
  calls.push({ name, args });
  if (name !== 'get_tiktok_integrated_report') throw new Error('tool inesperada: ' + name);
  return {
    list: [{
      dimensions: { campaign_id: 'cmp-1' },
      metrics: {
        spend: '10.00',
        impressions: '1000',
        clicks: '100',
        conversion: '5',
        ctr: '0.10',
        cpc: '0.10',
        cpm: '10.00',
        cost_per_conversion: '2.00',
      },
    }],
    page_info: { page: 1, total_page: 1, total_number: 1 },
  };
};

const provider = require('../ads-provider');

(async () => {
  const report = await provider.getIntegratedReport('adv-1', {
    level: 'AUCTION_CAMPAIGN',
    startDate: '2026-01-01',
    endDate: '2026-02-15',
  });

  assert.equal(report.chunks, 2, '46 dias são divididos em 2 blocos de no máximo 30 dias');
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(call => [call.args.start_date, call.args.end_date]), [
    ['2026-01-01', '2026-01-30'],
    ['2026-01-31', '2026-02-15'],
  ]);
  assert.ok(calls.every(call => call.name === 'get_tiktok_integrated_report'));
  assert.ok(calls.every(call => call.args.data_level === 'AUCTION_CAMPAIGN'));
  assert.ok(calls.every(call => call.args.dimensions.length === 1 && call.args.dimensions[0] === 'campaign_id'));

  assert.equal(report.rows.length, 1);
  const row = report.rows[0];
  assert.equal(row.id, 'cmp-1');
  assert.equal(row.spend, 20);
  assert.equal(row.impressions, 2000);
  assert.equal(row.clicks, 200);
  assert.equal(row.conversions, 10);
  assert.equal(row.ctr, 0.1, 'CTR é recalculado sobre o agregado');
  assert.equal(row.cpc, 0.1, 'CPC é recalculado sobre o agregado');
  assert.equal(row.cpm, 10, 'CPM é recalculado sobre o agregado');
  assert.equal(row.cpa, 2, 'CPA é recalculado sobre o agregado');

  await assert.rejects(
    () => provider.getIntegratedReport('adv-1', { level: 'AUCTION_ADGROUP', startDate: '2026-01-01', endDate: '2026-01-02' }),
    /não suportado/i,
  );
  await assert.rejects(
    () => provider.getIntegratedReport('adv-1', { level: 'AUCTION_CAMPAIGN', startDate: '2026-02-02', endDate: '2026-01-01' }),
    /inválido/i,
  );

  const routes = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
  const csvStart = routes.indexOf('function csvCell');
  const csvEnd = routes.indexOf("app.get('/api/ads/reports/export'", csvStart);
  const csvHelper = routes.slice(csvStart, csvEnd);
  assert.match(csvHelper, /\^\\s\*\[=\+\\-@\]/, 'CSV neutraliza células com fórmula');
  assert.match(csvHelper, /"'" \+ text/, 'CSV converte fórmula potencial em texto literal');

  console.log('ads-integrated-report: chunks, agregação, métricas e CSV seguro OK');
})().catch(error => { console.error(error); process.exitCode = 1; });
