'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const bulk = read('ads-bulk.js');
const routes = read('ads-routes.js');
const ops = read('ads-ops-store.js');
const store = read('ads-catalog-store.js');
const syncWorker = read('catalog/catalog-sync-worker.js');
const campaignWorker = read('catalog/catalog-campaign-worker.js');
const cloud = read('cloud-video-sync.js');
const bulkDialog = read('dashboard/components/ads/bulk-upload-dialog.tsx');
const launcher = read('dashboard/components/ads/universal-launcher-dialog.tsx');
const syncStatus = read('dashboard/components/ads/catalog-sync-status.tsx');
const campaignWizard = read('dashboard/components/ads/catalog-campaign-wizard.tsx');
const magicOps = read('dashboard/components/ads/magic-ops-panel.tsx');

console.log('Auditoria funcional V7 — filas e workers assíncronos');
assert.match(bulk, /reservedAt:\s*Date\.now\(\)/,
  'reserva Redis do bulk deve carimbar o momento real de processamento');
assert.match(bulk, /WORKER_LEASE_NAME[\s\S]*?acquireLease\(WORKER_LEASE_NAME/,
  'worker bulk deve possuir exclusão distribuída entre instâncias');
assert.match(bulk, /renewLease\(workerLease, WORKER_LEASE_TTL_SEC\)/,
  'lease do worker bulk deve ser renovado durante tarefas longas');
assert.match(bulk, /async function retryFailedBulkItems[\s\S]*?ads-bulk-retry:/,
  'retry de itens falhos deve ser serializado por job');
assert.match(routes, /bulk\.retryFailedBulkItems\(req\.account\.id, jobId, wanted\)/,
  'endpoint de retry deve usar a seção crítica do módulo de fila');
assert.match(bulk, /com Neon ativo[\s\S]*?if \(adsOps\.enabled\)[\s\S]*?getBulkSnapshot/,
  'polling do job deve consultar Neon antes do cache terminal em memória');
assert.match(ops, /kind NOT IN \('bulk_create', 'duplicate'\)/,
  'reconciliação genérica de boot não pode matar jobs da fila bulk durável');

console.log('Auditoria funcional V7 — catálogos duráveis');
assert.match(store, /async function heartbeatSyncRun/,
  'runs de sincronização devem possuir heartbeat de ownership');
assert.match(store, /async function heartbeatCampaignRun/,
  'runs de campanha devem possuir heartbeat de ownership');
assert.match(store, /status = 'running' AND updated_at < now\(\) - interval '5 minutes'/,
  'recovery de boot deve esperar uma janela compatível com heartbeat');
assert.match(syncWorker, /heartbeatSyncRun\(row\.account_id, row\.id, workerId\)/,
  'worker de catálogo deve renovar o lock durante processamento longo');
assert.match(campaignWorker, /heartbeatCampaignRun\(row\.account_id, row\.id, workerId\)/,
  'worker de campanha deve renovar o lock durante processamento longo');
assert.match(campaignWorker, /getCampaignRun\(accountId, row\.advertiser_id, runId\)[\s\S]*?latest\.createdIds/,
  'falha após onProgress deve reler os IDs parciais persistidos');
assert.match(campaignWorker, /const createdIds = \{ \.\.\.persistedCreatedIds, \.\.\.\(\(err && err\.createdIds\) \|\| \{\}\) \}/,
  'IDs do Error devem ser mesclados sem apagar o progresso já durável');

console.log('Auditoria funcional V7 — vídeos de nuvem');
assert.match(cloud, /acquireLease\(leaseName, SYNC_LEASE_TTL_SEC\)/,
  'sync manual e timer da nuvem devem compartilhar lease distribuído');
assert.match(cloud, /reason: lease && lease\.reason === 'busy' \? 'already_running' : 'lock_unavailable'/,
  'concorrência de sync deve retornar estado explícito em vez de duplicar upload');
assert.match(cloud, /fs\.promises\.unlink\(local\.target\)/,
  'arquivo temporário de nuvem deve ser limpo depois do upload');
assert.match(cloud, /await config\.setDurable\(accountId, \(latest\) =>/,
  'desconexão da nuvem deve persistir enabled=false antes de remover a credencial');
assert.match(magicOps, /result\.reason === 'already_running'/,
  'frontend deve explicar quando já existe sincronização da nuvem em andamento');

console.log('Auditoria funcional V7 — proteção contra duplo retry');
assert.match(bulkDialog, /const retryingRef = useRef\(false\)[\s\S]*?if \(!jobId \|\| retryingRef\.current\) return/,
  'bulk dialog deve bloquear retry repetido antes do próximo render');
assert.match(bulkDialog, /const submittingRef = useRef\(false\)[\s\S]*?if \(submittingRef\.current\) return/,
  'bulk dialog deve bloquear submit repetido antes do próximo render');
assert.match(launcher, /const retryingRef = useRef\(false\)[\s\S]*?if \(!jobId \|\| retryingRef\.current\) return/,
  'launcher deve bloquear reprocessamento duplicado');
assert.match(syncStatus, /const resumingRef = useRef\(false\)[\s\S]*?if \(resumingRef\.current\) return/,
  'retomar sync de catálogo deve ter trava síncrona');
assert.match(campaignWizard, /const actionBusyRef = useRef\(false\)[\s\S]*?if \(actionBusyRef\.current\) return false/,
  'resume/cleanup de campanha deve ter trava síncrona');

console.log('dashboard-functional-audit-v7: OK');
