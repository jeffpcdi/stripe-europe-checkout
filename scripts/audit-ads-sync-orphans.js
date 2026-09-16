#!/usr/bin/env node
'use strict';

// V16.13 — auditoria READ-ONLY dos resíduos capazes de alimentar o scheduler.
// Não possui --apply e nunca executa DELETE/UPDATE. Cleanup, se desejado, deve
// ser uma decisão operacional separada depois da inspeção do relatório.
const db = require('../db');
const config = require('../config');
const cache = require('../ads-cache-store');
const automation = require('../ads-automation');

(async () => {
  if (!db.enabled || !cache.enabled) {
    console.error('Neon não configurado; auditoria não pode consultar o estado persistido.');
    process.exitCode = 2;
    return;
  }
  const ready = await db.initWithRetry(3);
  if (!ready) throw new Error('Neon indisponível');
  await config.hydrate();
  await cache.ensureSchema();

  const validIds = new Set(await db.listAccountIds());
  const persistent = automation.inspectPersistentAutomationScopes(validIds);
  const [orphanConfigs, orphanSync, orphanAutomation] = await Promise.all([
    db.listOrphanAdsConfigs(500),
    cache.listOrphanSyncStates(500),
    cache.listOrphanAutomationStates(500),
  ]);

  const report = {
    generatedAt: new Date().toISOString(),
    readOnly: true,
    validAccounts: validIds.size,
    persistentEligibleScopes: persistent.scopes.length,
    skippedOrphanConfigAccounts: persistent.skippedOrphanAccounts,
    skippedOrphanPersistentScopes: persistent.skippedOrphanScopes,
    orphanConfigs: orphanConfigs.map((row) => ({
      accountId: row.key,
      advertiserId: row.pipeboard_ads && row.pipeboard_ads.advertiserId || null,
      updatedAt: row.updated_at || null,
    })),
    orphanSyncStates: orphanSync,
    orphanAutomationStates: orphanAutomation,
  };
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error('audit-ads-sync-orphans:', error && error.message ? error.message : error);
  process.exitCode = 1;
});
