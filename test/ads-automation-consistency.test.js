'use strict';

// Regressão do contrato de execução consistente:
// - cada regra lê sua própria janela civil;
// - métricas e atribuição usam o fuso do advertiser;
// - conflitos produzem uma única ação conservadora;
// - backtest e ciclo real usam o mesmo planejador.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const provider = require('../ads-provider');
const cache = require('../ads-cache-store');
const adsOps = require('../ads-ops-store');
const automation = require('../ads-automation');
const windowing = require('../ads-automation-window');

provider.enabled = true;
provider.resolveAdvertiserId = async () => 'adv_consistency';
provider.getAdvertiserInfo = async () => ({
  id: 'adv_consistency',
  timezone: 'America/Sao_Paulo',
});

const providerState = {};
provider.getState = (accountId) => providerState[accountId] || {};
provider.setState = (accountId, patch) => {
  providerState[accountId] = Object.assign({}, providerState[accountId], patch);
};

cache.listAutomationState = async () => [];
cache.upsertAutomationState = async () => {};
cache.deleteAutomationState = async () => {};
cache.getSyncState = async () => ({
  status: 'ok',
  last_synced_at: new Date().toISOString(),
  advertiser_timezone: 'America/Sao_Paulo',
});

adsOps.getSafetyPolicy = async () => adsOps.normalizePolicy({ dryRun: true });
adsOps.appendAuditEvent = async () => ({ id: 'audit_consistency' });
adsOps.countRecentEngineActions = async () => 0;
adsOps.saveBacktestRun = async () => null;

let leads = [];
automation.init({
  stats: { logEvent() {}, getStats: () => ({ leads }) },
  syncAfterWrite() {},
});

function campaign(metrics) {
  return {
    platformCampaignId: '1234567890123',
    campaignName: 'Campanha consistente',
    status: 'active',
    currency: 'BRL',
    metrics,
    adSets: [{
      platformAdSetId: 'grupo-1',
      budget: { amount: 50, type: 'daily' },
    }],
  };
}

const reads = [];
async function dashboardTree(options) {
  reads.push({ ...options });
  const days = 1 + Math.round((
    Date.parse(options.toDate + 'T00:00:00.000Z')
    - Date.parse(options.fromDate + 'T00:00:00.000Z')
  ) / 864e5);
  if (days === 1) {
    return {
      campaigns: [campaign({
        spend: 10,
        conversions: 0,
        impressions: 2000,
        clicks: 40,
      })],
    };
  }
  return {
    campaigns: [campaign({
      spend: 100,
      conversions: 5,
      impressions: 1000,
      clicks: 100,
    })],
  };
}
provider.getDashboardTree = async (_accountId, options) => dashboardTree(options);
cache.readTree = async (_accountId, _advertiserId, options) => dashboardTree(options);

function configureRules(accountId) {
  const current = automation.getAutomationProfile(accountId, 'adv_consistency');
  return automation.saveRules(accountId, 'adv_consistency', [
    {
      id: 'daily-pause',
      enabled: true,
      metric: 'spend_no_conv',
      threshold: 5,
      lookbackDays: 1,
      action: 'pause',
      mode: 'execute',
    },
    {
      id: 'weekly-down',
      enabled: true,
      metric: 'cpm_max',
      threshold: 50,
      minSpend: 1,
      lookbackDays: 7,
      action: 'budget_down',
      mode: 'execute',
    },
  ], current.revision);
}

(async () => {
  // Uma compra às 01:30 UTC ainda pertence ao dia anterior em São Paulo.
  leads = [{
    stage: 'purchased',
    convertedAt: '2026-07-28T01:30:00.000Z',
    reportedAmount: 9900,
    utm: { source: 'tiktok', campaign: '1234567890123' },
  }];
  const inSaoPaulo = automation.computeAttribution(
    'acc_attribution_zone',
    '2026-07-27',
    '2026-07-27',
    'America/Sao_Paulo',
  );
  const inUtc = automation.computeAttribution(
    'acc_attribution_zone',
    '2026-07-27',
    '2026-07-27',
    'UTC',
  );
  assert.strictEqual(inSaoPaulo.byCampaign['1234567890123'].sales, 1, 'atribuição respeita o dia civil do advertiser');
  assert.strictEqual(inUtc.byCampaign['1234567890123'], undefined, 'o mesmo evento não cai artificialmente no dia UTC anterior');
  leads[0].reportedCurrency = 'EUR';
  const moneyAttribution = () => automation.computeAttribution('acc_attribution_zone', '2026-07-27', '2026-07-27', 'America/Sao_Paulo', true).byCampaign['1234567890123'];
  assert.strictEqual(moneyAttribution().currency, 'EUR', 'receita preserva moeda real');
  leads.push({ ...leads[0], reportedCurrency: 'USD' });
  assert.strictEqual(moneyAttribution().currency, null, 'moedas diferentes não recebem rótulo de moeda única');
  leads = [];

  const accountId = 'acc_rule_windows';
  configureRules(accountId);
  reads.length = 0;
  const sweep = await automation.runRulesSweep(accountId, {
    force: true,
    advertiserId: 'adv_consistency',
  });

  assert.strictEqual(reads.length, 2, 'duas janelas distintas geram duas leituras');
  const oneDay = reads.find((row) => row.fromDate === row.toDate);
  const sevenDays = reads.find((row) => row.fromDate !== row.toDate);
  assert.ok(oneDay, 'regra diária lê somente hoje');
  assert.ok(sevenDays, 'regra semanal recebe janela própria');
  assert.strictEqual(
    sevenDays.fromDate,
    windowing.shiftCivilDay(sevenDays.toDate, -6),
    'janela de 7 dias contém hoje e os seis dias anteriores',
  );
  assert.strictEqual(sweep.timeZone, 'America/Sao_Paulo');
  assert.strictEqual(sweep.windows.length, 2);
  assert.strictEqual(sweep.executed.length, 1, 'uma campanha recebe no máximo uma ação por ciclo');
  assert.strictEqual(sweep.executed[0].action, 'pause', 'pausa vence redução de orçamento no conflito');
  assert.strictEqual(sweep.conflicts.length, 1, 'conflito fica transparente na resposta');
  assert.strictEqual(sweep.conflicts[0].suppressed[0].action, 'budget_down');

  reads.length = 0;
  const backtest = await automation.backtestRules(accountId, {
    rules: automation.getRules(accountId, 'adv_consistency'),
    advertiserId: 'adv_consistency',
  });
  assert.strictEqual(reads.length, 2, 'backtest reutiliza as duas janelas do ciclo real');
  assert.strictEqual(backtest.findings.length, 1, 'backtest também seleciona uma única decisão');
  assert.strictEqual(backtest.findings[0].action, 'pause');
  assert.strictEqual(backtest.summary.candidateHits, 2, 'candidatos suprimidos continuam observáveis');
  assert.strictEqual(backtest.summary.hits, 1, 'hits representa decisões efetivas, não ações conflitantes');
  assert.strictEqual(backtest.conflicts.length, 1);
  assert.strictEqual(backtest.window.timeZone, 'America/Sao_Paulo');
  assert.deepStrictEqual(
    backtest.window.groups.map((group) => group.lookbackDays).sort((a, b) => a - b),
    [1, 7],
  );

  // O schema e o write-through mantêm o fuso disponível após restart.
  const cacheSource = fs.readFileSync(path.join(__dirname, '..', 'ads-cache-store.js'), 'utf8');
  assert.match(cacheSource, /advertiser_timezone text/, 'schema persiste o fuso do advertiser');
  assert.match(cacheSource, /advertiserTimezone/, 'upsert recebe o fuso descoberto pelo sync');
  const routesSource = fs.readFileSync(path.join(__dirname, '..', 'ads-routes.js'), 'utf8');
  const runStart = routesSource.indexOf("app.post('/api/ads/rules/run'");
  const runEnd = routesSource.indexOf("app.post('/api/ads/rules/backtest'", runStart);
  const manualRun = routesSource.slice(runStart, runEnd);
  assert.doesNotMatch(manualRun, /Promise\.all/, 'execução manual não dispara regras e agenda em paralelo');
  assert.ok(
    manualRun.indexOf("'rules'") < manualRun.indexOf("'schedule'"),
    'execução manual aplica regras antes de reconciliar a agenda',
  );
  const opsSource = fs.readFileSync(path.join(__dirname, '..', 'ads-ops-store.js'), 'utf8');
  assert.match(
    opsSource,
    /'rule_action\.partial'.*'rule_proposal\.partial'/s,
    'mutações parciais reais entram no cap durável de ações por hora',
  );

  console.log('ads-automation-consistency.test.js: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
