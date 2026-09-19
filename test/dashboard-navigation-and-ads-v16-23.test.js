'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const navigation = read('dashboard/lib/navigation.ts');
assert.match(navigation, /routes: \['\/', '\/activity', '\/funnel', '\/geo', '\/live'\]/);

const topnav = read('dashboard/components/shell/topnav.tsx');
assert.match(topnav, /NAV_GROUPS/);
assert.doesNotMatch(topnav, /const PRIMARY_LINKS = \[/);

const mobile = read('dashboard/components/shell/mobile-nav.tsx');
assert.match(mobile, /activeGroup/);
assert.match(mobile, /group\.id === 'overview'/);
assert.match(mobile, /pathname\.startsWith\('\/gateways'\)/);

const palette = read('dashboard/components/shell/command-palette.tsx');
assert.match(palette, /href: '\/\?p=today'/);

const overview = read('dashboard/components/overview/overview-view.tsx');
assert.match(overview, /<SetupGuide health=\{overviewHealth\}/);
assert.match(overview, /data-tour="confidence"/);

const calendar = read('dashboard/components/shell/overview-calendar.tsx');
assert.match(calendar, /data-tour="period"/);

const metrics = read('dashboard/components/overview/overview-metrics.tsx');
assert.match(metrics, /data-tour="kpis"/);

const globe = read('dashboard/components/overview/hero-globe.tsx');
assert.match(globe, /data-tour="chart"/);
assert.match(globe, /data-tour="live-badge"/);

const tour = read('dashboard/lib/tour.ts');
assert.match(tour, /fuso configurado na conta/);
assert.match(tour, /Campanhas/);
assert.doesNotMatch(tour, /Links protegidos/);

const destination = read('dashboard/components/ads/ad-destination-field.tsx');
assert.match(destination, /useLinks\(\)/);
assert.match(destination, /useCloakEntries\(\)/);
assert.match(destination, /Links de venda/);
assert.match(destination, /Campanhas Cloaker/);
assert.match(destination, /utm|atribuição/i);

for (const file of [
  'dashboard/components/ads/universal-launcher-dialog.tsx',
  'dashboard/components/ads/smart-plus-create-dialog.tsx',
  'dashboard/components/ads/bulk-upload-dialog.tsx',
]) {
  assert.match(read(file), /AdDestinationField/);
}

const bulk = read('dashboard/components/ads/bulk-upload-dialog.tsx');
assert.match(bulk, /href="\/conversions\?tab=pixels"/);
assert.doesNotMatch(bulk, /\/dashboard\/pixels/);

console.log('dashboard-navigation-and-ads-v16-23: navegação, tours e destinos integrados OK');
