'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let response, calls;
const pipeboard = { callTool: async (name, args) => {
  assert.strictEqual(name, 'get_tiktok_insights'); calls.push(args);
  return response(args);
} };
const context = { module: { exports: {} }, process: { env: {} }, console,
  require: (name) => name === './pipeboard-mcp' ? pipeboard : {},
};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'ads-provider.js'), 'utf8'), context);
const provider = context.module.exports;
const row = (id) => ({ dimensions: { campaign_id: String(id), stat_time_day: '2026-09-01' }, metrics: { spend: '2', conversion: '1' } });
const read = () => { calls = []; return provider.getInsights('adv', { startDate: '2026-09-01', endDate: '2026-09-02', dimensions: ['campaign_id', 'stat_time_day'] }); };
(async () => {
  response = ({ page }) => ({ metrics: page === 1 ? Array.from({ length: 100 }, (_, i) => row(i)) : [row(100)], page_info: { page, total_page: 2, total_number: 101 } });
  let result = await read();
  assert.strictEqual(result.rows.length, 101);
  assert.strictEqual(result.rows.reduce((n, r) => n + r.spend, 0), 202);
  assert.strictEqual(calls.length, 2);
  assert.ok(calls.every((c) => c.advertiser_id === 'adv' && c.start_date === '2026-09-01' && c.dimensions[1] === 'stat_time_day'));
  response = ({ page }) => ({ metrics: page === 1 ? [row(1)] : [row(2)], total_rows: 2 });
  result = await read();
  assert.strictEqual(result.totalRows, 2, 'total_rows também orienta a paginação');
  response = ({ page }) => ({ metrics: page === 1 ? Array.from({ length: 100 }, (_, i) => row(i)) : [] });
  assert.strictEqual((await read()).rows.length, 100, 'sem metadados consulta até página vazia/curta');
  response = () => ({ metrics: [] });
  assert.strictEqual((await read()).totalRows, 0, 'zero confirmado é válido');
  response = () => ({ ok: false });
  await assert.rejects(read(), /inválida/);
  response = ({ page }) => { if (page === 2) throw Error('timeout'); return { metrics: [row(1)], page_info: { page, total_page: 2 } }; };
  await assert.rejects(read(), /timeout/, 'erro na segunda página não devolve totais parciais');
  response = ({ page }) => ({ metrics: [row(1)], page_info: { page, total_page: 2 } });
  await assert.rejects(read(), /repetiu/);
  response = ({ page }) => ({ metrics: page === 1 ? [row(1)] : [], page_info: { page, total_page: 3 } });
  await assert.rejects(read(), /vazia/);
  response = () => ({ metrics: [row(1)], page_info: { page: 1, total_page: 1, total_number: 10 } });
  await assert.rejects(read(), /antes do total/);
  response = ({ page }) => ({ metrics: [row(page)], page_info: { page, total_page: 201 } });
  await assert.rejects(read(), /Limite/);
  assert.strictEqual(calls.length, 200, 'teto falha explicitamente, sem truncar');
  console.log('ads-insights-pagination: totais completos, falhas, páginas repetidas e limites OK');
})().catch((e) => { console.error(e); process.exitCode = 1; });
