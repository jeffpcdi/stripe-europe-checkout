'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Navegação global: uma fonte de verdade e drill-downs pertencem à Visão Geral.
const nav = read('dashboard/lib/navigation.ts');
assert.match(nav, /routes: \['\/', '\/activity', '\/funnel', '\/geo', '\/live'\]/);

const topnav = read('dashboard/components/shell/topnav.tsx');
assert.match(topnav, /import \{ NAV_GROUPS \} from '@\/lib\/navigation'/);
assert.doesNotMatch(topnav, /const PRIMARY_LINKS = \[\s*\{/);

// Visão Geral: setup voltou a ser visível e os alvos do tour existem.
const overview = read('dashboard/components/overview/overview-view.tsx');
assert.match(overview, /<SetupGuide health=\{overviewHealth\} \/>/);
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
assert.match(tour, /title: 'Campanhas'/);
assert.match(tour, /return seg === 'gateways' \? GATEWAYS_TOUR : PIXELS_TOUR/);

// Atividade: deep-links funcionam e incluem refunds/disputes.
const activity = read('dashboard/components/activity/activity-view.tsx');
assert.match(activity, /type ActivityFilter = 'all' \| 'sale' \| 'checkout' \| 'visit' \| 'failed' \| 'refund' \| 'dispute'/);
assert.match(activity, /searchParams\.get\('f'\)/);
assert.match(activity, /router\.replace\(pathname/);
assert.match(activity, /Reembolsos/);
assert.match(activity, /Contestações/);
assert.match(activity, /formatDateTime\(event\.at, accountTimeZone\)/);

// Conta: tabs URL-addressable, conteúdo introdutório e hints realmente renderizam.
const config = read('dashboard/components/config/config-view.tsx');
assert.match(config, /useSearchParams/);
assert.match(config, /function SectionIntro\(\{ eyebrow, title, description \}/);
assert.doesNotMatch(config, /function SectionIntro\(_props[^]*return null/);
assert.match(config, /\{hint\}<\/p>/);

const configPage = read('dashboard/app/(dashboard)/config/page.tsx');
assert.match(configPage, /<Suspense>/);

// TikTok Ads: nenhum atalho volta para a rota antiga de pixels.
const bulk = read('dashboard/components/ads/bulk-upload-dialog.tsx');
assert.match(bulk, /href="\/conversions\?tab=pixels"/);
assert.doesNotMatch(bulk, /\/dashboard\/pixels/);

// Links/Domínios: páginas principais têm hierarquia consistente.
const links = read('dashboard/components/links/links-view.tsx');
assert.match(links, /<h1[^>]*>Links de venda<\/h1>/);
assert.match(links, /data\?\.baseUrl/);

const domains = read('dashboard/components/domains/domains-view.tsx');
assert.match(domains, /<h1[^>]*>Domínios<\/h1>/);
assert.match(domains, /Usar em/);
assert.match(domains, /uso: usage/);

const conversions = read('dashboard/components/conversions/conversions-view.tsx');
assert.match(conversions, /Pixel &amp; Conversões/);
assert.match(conversions, /Configure pixels, conecte checkouts e acompanhe a entrega real das conversões/);

console.log('dashboard-project-coherence-v16-23: navegação, onboarding, rastreamento, conta e TikTok coerentes');
