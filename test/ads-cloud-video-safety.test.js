'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const adsOps = require('../ads-ops-store');
const cloud = require('../cloud-video-sync');

const originalGetSafetyPolicy = adsOps.getSafetyPolicy;

(async () => {
  const cases = [
    [{ enabled:true, dryRun:true, killSwitch:false, blockedAdvertiserIds:[] }, 'dry_run'],
    [{ enabled:true, dryRun:false, killSwitch:true, blockedAdvertiserIds:[] }, 'kill_switch'],
    [{ enabled:false, dryRun:false, killSwitch:false, blockedAdvertiserIds:[] }, 'safety_policy_disabled'],
    [{ enabled:true, dryRun:false, killSwitch:false, blockedAdvertiserIds:['adv-1'] }, 'advertiser_blocked'],
  ];

  for (const [policy, expected] of cases) {
    adsOps.getSafetyPolicy = async () => policy;
    const result = await cloud.syncOne('tenant', 'dropbox', 'adv-1');
    assert.equal(result.skipped, true);
    assert.equal(result.reason, expected);
  }

  adsOps.getSafetyPolicy = async () => { throw new Error('neon offline'); };
  const unavailable = await cloud.syncOne('tenant', 'googleDrive', 'adv-1');
  assert.equal(unavailable.skipped, true);
  assert.equal(unavailable.reason, 'safety_policy_unavailable');

  const source = fs.readFileSync(require.resolve('../cloud-video-sync'), 'utf8');
  assert.match(source, /getSafetyPolicy\(accountId\)/);
  assert.ok(source.indexOf('getSafetyPolicy(accountId)') < source.indexOf('await ensureSchema();', source.indexOf('async function syncOne')),
    'policy é validada antes de iniciar a sincronização');
  assert.doesNotMatch(source, /states\[0\].*advertiser_id/, 'worker nunca escolhe automaticamente a primeira conta de anúncios');
  assert.match(source, /const advertiserId = String\(pref\.advertiserId \|\| ''\)\.trim\(\)/, 'worker exige advertiser persistido explicitamente');

  const panel = fs.readFileSync(require.resolve('../dashboard/components/ads/cloud-video-sync-panel.tsx'), 'utf8');
  const saved = fs.readFileSync(require.resolve('../dashboard/components/ads/saved-videos.tsx'), 'utf8');
  const routes = fs.readFileSync(require.resolve('../ads-routes'), 'utf8');
  const view = fs.readFileSync(require.resolve('../dashboard/components/ads/tiktok-ads-view.tsx'), 'utf8');

  assert.match(panel, /Sincronização automática/);
  assert.match(panel, /Novos vídeos da pasta entram na biblioteca automaticamente/);
  assert.match(panel, /safetyBlocked/);
  assert.match(panel, /Modo simulação ativo/);
  assert.match(panel, /window\.location\.assign/);
  assert.match(saved, /appearance === 'default'/);
  assert.match(saved, /<CloudVideoSyncPanel advertiserId=\{advertiserId\}/);
  assert.match(routes, /\/dashboard\/ads\/tiktok\?cloudVideo=connected/);
  assert.match(routes, /enabled: current\.enabled === true && Boolean\(String\(current\.advertiserId \|\| ''\)\.trim\(\)\)/,
    'primeira conexão OAuth fica pausada até receber advertiser explícito');
  assert.match(view, /cloudVideo/);
  assert.match(view, /Nuvem conectada/);

  console.log('ads-cloud-video-safety: guardrails, OAuth return e UI contextual OK');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  adsOps.getSafetyPolicy = originalGetSafetyPolicy;
});
