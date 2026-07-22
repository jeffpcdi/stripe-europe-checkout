// ─────────────────────────────────────────────────────────────────────────────
// ads-automation.js — Motor de automações do TikTok Ads (regras + alertas +
// dayparting), extraído do ads-routes.js para rodar 24/7 no servidor.
//
// PORQUÊ: as varreduras viviam numa closure de ads-routes.js e só rodavam "de
// carona" no polling da dashboard (adsSweepHook). Dashboard fechada = nenhuma
// regra agia. Agora o mesmo motor é consumido por DOIS gatilhos:
//   1. o tick de 3 min do ads-sync.js (24/7, sem depender de tela aberta);
//   2. o hook oportunista das rotas (mantido — melhora a latência percebida).
// O throttle é ÚNICO (por conta, dentro deste módulo), então dois gatilhos
// nunca causam varredura/ação dupla.
//
// Fonte de dados: o ESPELHO Neon (ads-cache-store) — zero chamadas extras à
// Pipeboard por varredura. Só as AÇÕES (pause/budget) tocam a API. Sweep só
// age com espelho fresco (last_synced_at ≤ FRESHNESS_MS); dado velho = pula.
//
// Cooldowns persistidos em ads_automation_state (Neon): um deploy não re-arma
// os cooldowns (uma regra não age 2× no mesmo episódio). Sem Neon, degrada
// para memória (comportamento antigo).
//
// Sem require circular: ads-sync importa este módulo; este módulo NÃO importa
// ads-sync (o syncAfterWrite pós-ação é injetado via init()).
// ─────────────────────────────────────────────────────────────────────────────
const provider = require('./ads-provider');
const cache = require('./ads-cache-store');
const adsOps = require('./ads-ops-store');
const redis = require('./redis');
const { sendPushcut } = require('./pushcut');

// ── Configuração ────────────────────────────────────────────────────────────
const SWEEP_THROTTLE_MS = Number(process.env.ADS_RULES_SWEEP_MS) || 30 * 60e3;      // regras+alertas: 30min/conta
const SCHEDULE_THROTTLE_MS = Number(process.env.ADS_SCHEDULE_SWEEP_MS) || 4 * 60e3; // dayparting: ~todo tick
const FRESHNESS_MS = Number(process.env.ADS_SWEEP_FRESHNESS_MS) || 15 * 60e3;       // idade máx. do espelho p/ agir
const RULE_COOLDOWN_MS = 12 * 3600e3;   // 1 ação por episódio (12h por campanha+regra)
const SCALE_COOLDOWN_MS = 24 * 3600e3;  // roas_scale: no máx. 1 escala/dia por campanha
const ALERT_COOLDOWN_MS = 6 * 3600e3;   // alertas: 6h por campanha+regra
const APPEAL_COOLDOWN_MS = 7 * 24 * 3600e3; // auto-appeal Smart+: no máx. 1×/incidente a cada 7 dias
const APPEAL_RETRY_MS = 60 * 60e3; // falha transitória: espera 1h antes de tentar o mesmo incidente

const RULE_METRICS = ['cpa_max', 'spend_no_conv', 'roas_min', 'ctr_min', 'cpm_max', 'cpc_max', 'roas_scale', 'schedule'];
const RULE_ACTIONS = ['pause', 'budget_down', 'budget_up'];
const ALERT_DEFAULTS = { enabled: false, spendNoConv: 20, cpaMax: 0, lookbackDays: 2, rejectedAds: false, autoAppealSmartPlus: false };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const AUTOMATION_AUTONOMY = ['notify', 'propose', 'auto'];
const AUTOMATION_PROFILE_LIMIT = 10;

// stats é injetado pelas rotas (logEvent + getStats p/ atribuição). Antes de
// init(), tudo degrada para noop — nenhum sweep quebra por falta de stats.
let stats = { logEvent() {}, getStats: null };
// pós-ação: força sync imediato p/ o espelho refletir a mudança (injetado —
// evita require circular com ads-sync).
let syncAfterWrite = () => {};
function init(deps = {}) {
  if (deps.stats) stats = deps.stats;
  if (typeof deps.syncAfterWrite === 'function') syncAfterWrite = deps.syncAfterWrite;
}

// ── Estado persistido (cooldowns + marcações do dayparting) ─────────────────
// Cache quente em memória + write-through no Neon. Carga preguiçosa por conta.
const memState = new Map();     // accId → Map(key → { at:ms, meta })
const loadedAccounts = new Map(); // accId → Promise (dedupe de cargas)

async function ensureLoaded(accId) {
  if (memState.has(accId) && loadedAccounts.has(accId)) return loadedAccounts.get(accId);
  if (!memState.has(accId)) memState.set(accId, new Map());
  const p = (async () => {
    try {
      // listAutomationState já devolve [] quando o Neon está desligado —
      // sem guarda extra aqui (e os testes conseguem stubar a função).
      const rows = await cache.listAutomationState(accId);
      const m = memState.get(accId);
      for (const r of rows) {
        const at = r.lastFiredAt ? new Date(r.lastFiredAt).getTime() : 0;
        // Neon é a fonte da verdade no boot; memória mais nova (escrita entre
        // a carga e agora) vence.
        const cur = m.get(r.key);
        if (!cur || cur.at < at) m.set(r.key, { at, meta: r.meta || {} });
      }
    } catch (e) {
      console.warn('[ads-automation] carga de estado falhou (segue em memória):', e.message);
    }
  })();
  loadedAccounts.set(accId, p);
  return p;
}

function getMem(accId, key) { return (memState.get(accId) || new Map()).get(key) || null; }

async function markFired(accId, key, kind, meta) {
  await ensureLoaded(accId);
  memState.get(accId).set(key, { at: Date.now(), meta: meta || {} });
  // write-through best-effort: falha de Neon nunca bloqueia a ação
  cache.upsertAutomationState(accId, key, kind, meta).catch(() => {});
}

async function clearFired(accId, key) {
  await ensureLoaded(accId);
  memState.get(accId).delete(key);
  cache.deleteAutomationState(accId, key).catch(() => {});
}

async function underCooldown(accId, key, ms) {
  await ensureLoaded(accId);
  const cur = getMem(accId, key);
  return !!(cur && Date.now() - cur.at < ms);
}

// ── Presets de fábrica (regras prontas, PAUSADAS; alertas ligados) ──────────
// Pacote sensato que o usuário ativa com 1 clique cada. Decisão de produto:
// regras que AGEM (pausam/mexem em orçamento) nascem enabled:false — dinheiro
// real exige revisão dos thresholds antes; alertas só notificam, então nascem
// ligados. Todos os valores passam por validateRules sem mutação (testado) —
// inclusive o budgetCap do roas_scale, obrigatório para a regra ser válida.
// Janela padrão DIÁRIA (lookbackDays:1) — pedido do produto. Os pisos de
// volume (minClicks/minImpressions/minSpend) protegem contra o ruído de 1 dia;
// a UI ainda exibe aviso de estabilidade quando a janela é < 3 dias.
function buildRulePresets() {
  return validateRules([
    {
      id: 'preset_cpa', preset: true, enabled: false,
      name: 'CPA alto → pausar',
      description: 'Pausa campanhas cujo custo por conversão passar de 15 € no dia. Só age com volume mínimo (30 cliques / 1000 impressões) — ruído não é sinal.',
      metric: 'cpa_max', threshold: 15, lookbackDays: 1, action: 'pause', minClicks: 30, minImpressions: 1000,
    },
    {
      id: 'preset_noconv', preset: true, enabled: false,
      name: 'Gasto sem venda → pausar',
      description: 'Pausa campanhas que gastarem 20 € no dia sem NENHUMA conversão. Mesmos pisos de volume do CPA.',
      metric: 'spend_no_conv', threshold: 20, lookbackDays: 1, action: 'pause', minClicks: 30, minImpressions: 1000,
    },
    {
      id: 'preset_ctr', preset: true, enabled: false,
      name: 'CTR baixo → pausar',
      description: 'Pausa campanhas com CTR abaixo de 0,5% após 2000 impressões — criativo que não engaja só queima orçamento.',
      metric: 'ctr_min', threshold: 0.5, lookbackDays: 1, action: 'pause', minImpressions: 2000,
    },
    {
      id: 'preset_scale', preset: true, enabled: false,
      name: 'ROAS bom → escalar',
      description: 'Aumenta o orçamento em 20% quando o ROAS atribuído passar de 2,0 com pelo menos 2 vendas. Teto absoluto de 100 €/dia por campanha — escala sem limite é o risco nº 1.',
      metric: 'roas_scale', threshold: 2, lookbackDays: 1, minSales: 2, pct: 20, budgetCap: 100,
    },
    {
      id: 'preset_cpm', preset: true, enabled: false,
      name: 'CPM caro → reduzir orçamento',
      description: 'Reduz o orçamento em 20% quando o CPM passar de 12 € com pelo menos 5 € gastos — leilão caro demais para insistir no mesmo volume.',
      metric: 'cpm_max', threshold: 12, lookbackDays: 1, action: 'budget_down', pct: 20, minSpend: 5,
    },
    {
      id: 'preset_cpc', preset: true, enabled: false,
      name: 'CPC alto → reduzir orçamento',
      description: 'Reduz o orçamento em 20% quando o custo por clique passar de 1 € no dia, após 30 cliques — clique caro demais para insistir no mesmo volume.',
      metric: 'cpc_max', threshold: 1, lookbackDays: 1, action: 'budget_down', pct: 20, minClicks: 30,
    },
    {
      id: 'preset_roasmin', preset: true, enabled: false,
      name: 'ROAS baixo → pausar',
      description: 'Pausa campanhas com ROAS atribuído abaixo de 1,0 no dia. Só age quando a conta já tem venda atribuída no período — ROAS "0" pode ser só atraso de webhook.',
      metric: 'roas_min', threshold: 1, lookbackDays: 1, action: 'pause',
    },
    {
      id: 'preset_scale_agro', preset: true, enabled: false,
      name: 'ROAS excelente → escalar agressivo',
      description: 'Aumenta o orçamento em 30% quando o ROAS atribuído passar de 3,0 com pelo menos 2 vendas. Teto absoluto de 200 €/dia por campanha.',
      metric: 'roas_scale', threshold: 3, lookbackDays: 1, minSales: 2, pct: 30, budgetCap: 200,
    },
    {
      id: 'preset_schedule', preset: true, enabled: false,
      name: 'Horário comercial (seg–sex)',
      description: 'Liga as campanhas às 09:00 e pausa às 23:00, de segunda a sexta (fuso Europe/Lisbon). Fora da janela, tudo pausado.',
      metric: 'schedule', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '23:00', timezone: 'Europe/Lisbon',
    },
  ]);
}
// Alertas pré-ligados: SÓ notificam (nunca agem), então podem nascer ativos.
const ALERT_PRESET = { enabled: true, spendNoConv: 20, cpaMax: 15, lookbackDays: 2, rejectedAds: true };

// ── Perfis por advertiser + revisão otimista ───────────────────────────────
// Regra/alerta/autonomia pertencem à CONTA DE ANÚNCIOS, não ao usuário da
// dashboard. Antes, trocar o advertiser selecionado fazia as mesmas regras
// passarem a agir em outra conta. O perfil também carrega uma única revisão:
// regras, alertas e autonomia formam um contrato atômico e duas abas não podem
// sobrescrever silenciosamente uma à outra.
function cleanAdvertiserId(value) {
  return String(value || '').trim().slice(0, 120);
}

function scopedStateKey(advertiserId, key) {
  return 'adv:' + cleanAdvertiserId(advertiserId) + ':' + key;
}

function profileId(accId, advertiserId) {
  const st = provider.getState(accId);
  return cleanAdvertiserId(advertiserId || st.advertiserId) || '__default__';
}

function inferAutonomy(rules, alertsEnabled, fallback) {
  const enabled = (rules || []).filter((r) => r.enabled);
  if (!enabled.length) {
    if (fallback === 'auto' || fallback === 'propose') return fallback;
    return alertsEnabled ? 'notify' : 'custom';
  }
  const modes = new Set(enabled.map((r) => r.mode === 'execute' ? 'execute' : 'proposal'));
  if (modes.size !== 1) return 'custom';
  return modes.has('execute') ? 'auto' : 'propose';
}

function normalizedProfile(raw, advertiserId) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const rules = Array.isArray(p.rules) ? validateRules(p.rules) : buildRulePresets();
  const alerts = Object.assign({}, ALERT_DEFAULTS, p.alerts && typeof p.alerts === 'object' ? p.alerts : ALERT_PRESET);
  return {
    advertiserId,
    revision: Math.max(1, parseInt(p.revision, 10) || 1),
    rules,
    alerts,
    rulesLog: Array.isArray(p.rulesLog) ? p.rulesLog.slice(0, 50) : [],
    autonomy: AUTOMATION_AUTONOMY.includes(p.autonomy) ? p.autonomy : inferAutonomy(rules, alerts.enabled),
    lastEnabledRuleIds: Array.isArray(p.lastEnabledRuleIds) ? p.lastEnabledRuleIds.map(String).slice(0, AUTOMATION_PROFILE_LIMIT) : [],
    lastAutoAppealSmartPlus: p.lastAutoAppealSmartPlus === true,
    updatedAt: p.updatedAt || new Date().toISOString(),
  };
}

function getAutomationProfile(accId, advertiserId) {
  const st = provider.getState(accId);
  const id = profileId(accId, advertiserId);
  const profiles = st.automationProfiles && typeof st.automationProfiles === 'object' ? st.automationProfiles : {};
  if (profiles[id]) return normalizedProfile(profiles[id], id);

  // Migração conservadora: o estado legado é copiado somente para o primeiro
  // advertiser que o usuário abrir. Ele fica no root por rollback, mas jamais
  // é reutilizado para um segundo advertiser.
  const canMigrateLegacy = !st.automationLegacyMigratedTo
    && (Array.isArray(st.rules) || (st.alerts && typeof st.alerts === 'object') || Array.isArray(st.rulesLog));
  const seed = canMigrateLegacy ? {
    rules: Array.isArray(st.rules) ? st.rules : buildRulePresets(),
    alerts: st.alerts && typeof st.alerts === 'object' ? st.alerts : ALERT_PRESET,
    rulesLog: Array.isArray(st.rulesLog) ? st.rulesLog : [],
    autonomy: st.autonomy,
    updatedAt: st.updatedAt,
  } : {};
  const profile = normalizedProfile(seed, id);
  provider.setState(accId, {
    automationProfiles: { ...profiles, [id]: profile },
    ...(canMigrateLegacy ? { automationLegacyMigratedTo: id } : {}),
  });
  return profile;
}

function persistProfile(accId, advertiserId, profile) {
  const st = provider.getState(accId);
  const id = profileId(accId, advertiserId);
  const profiles = st.automationProfiles && typeof st.automationProfiles === 'object' ? st.automationProfiles : {};
  const normalized = normalizedProfile(profile, id);
  provider.setState(accId, { automationProfiles: { ...profiles, [id]: normalized } });
  return normalized;
}

function revisionConflict(current) {
  const err = new Error('A configuração mudou em outra aba. Recarregue e tente novamente.');
  err.status = 409;
  err.code = 'AUTOMATION_REVISION_CONFLICT';
  err.currentRevision = current.revision;
  return err;
}

function updateAutomationProfile(accId, advertiserId, expectedRevision, mutator) {
  const current = getAutomationProfile(accId, advertiserId);
  const expected = Number(expectedRevision);
  if (!Number.isInteger(expected) || expected !== current.revision) throw revisionConflict(current);
  const changed = mutator({ ...current, rules: [...current.rules], alerts: { ...current.alerts } }) || current;
  return persistProfile(accId, advertiserId, {
    ...changed,
    revision: current.revision + 1,
    updatedAt: new Date().toISOString(),
  });
}

function getAlertCfg(accId, advertiserId) {
  return { ...getAutomationProfile(accId, advertiserId).alerts };
}
function getRules(accId, advertiserId) {
  return [...getAutomationProfile(accId, advertiserId).rules];
}
function getRulesLog(accId, advertiserId) {
  return [...getAutomationProfile(accId, advertiserId).rulesLog];
}
function appendRulesLog(accId, entries, advertiserId) {
  if (!entries.length) return;
  const profile = getAutomationProfile(accId, advertiserId);
  persistProfile(accId, advertiserId, { ...profile, rulesLog: [...entries, ...profile.rulesLog].slice(0, 50) });
}

function saveRules(accId, advertiserId, rawRules, expectedRevision) {
  if (!Array.isArray(rawRules)) { const e = new Error('Lista de regras inválida'); e.status = 400; throw e; }
  if (rawRules.length > AUTOMATION_PROFILE_LIMIT) {
    const e = new Error('Limite de ' + AUTOMATION_PROFILE_LIMIT + ' regras por conta de anúncios'); e.status = 400; e.code = 'AUTOMATION_RULE_LIMIT'; throw e;
  }
  return updateAutomationProfile(accId, advertiserId, expectedRevision, (p) => {
    const rules = validateRules(rawRules);
    return { ...p, rules, autonomy: inferAutonomy(rules, p.alerts.enabled, p.autonomy) };
  });
}

function saveAlerts(accId, advertiserId, rawCfg, expectedRevision) {
  const b = rawCfg || {};
  const current = getAutomationProfile(accId, advertiserId);
  if (b.autoAppealSmartPlus === true && current.autonomy !== 'auto') {
    const e = new Error('Recurso automático exige o modo “Agir sozinho”.');
    e.status = 409;
    e.code = 'AUTOMATION_AUTONOMY_REQUIRED';
    throw e;
  }
  const alerts = {
    enabled: !!b.enabled,
    spendNoConv: Math.max(0, Math.min(100000, Number(b.spendNoConv) || 0)),
    cpaMax: Math.max(0, Math.min(100000, Number(b.cpaMax) || 0)),
    lookbackDays: Math.max(1, Math.min(30, parseInt(b.lookbackDays, 10) || 2)),
    rejectedAds: b.rejectedAds === true,
    autoAppealSmartPlus: b.autoAppealSmartPlus === true,
  };
  return updateAutomationProfile(accId, advertiserId, expectedRevision, (p) => ({
    ...p,
    alerts,
    autonomy: p.autonomy === 'notify' && !alerts.enabled ? 'custom' : p.autonomy,
    lastAutoAppealSmartPlus: p.autonomy === 'auto' ? alerts.autoAppealSmartPlus : p.lastAutoAppealSmartPlus,
  }));
}

// Alteração GLOBAL e atômica: afeta pilotos, regras avançadas, agendamentos e
// alertas na mesma revisão. Ao entrar em “Só avisar”, guarda exatamente quais
// regras estavam ligadas; ao sair, restaura só essas regras.
function setGlobalAutonomy(accId, advertiserId, autonomy, expectedRevision) {
  if (!AUTOMATION_AUTONOMY.includes(autonomy)) { const e = new Error('Modo de autonomia inválido'); e.status = 400; throw e; }
  return updateAutomationProfile(accId, advertiserId, expectedRevision, (p) => {
    const enabledIds = p.rules.filter((r) => r.enabled).map((r) => r.id);
    const restore = new Set(p.lastEnabledRuleIds || []);
    const rememberedAutoAppeal = p.alerts.autoAppealSmartPlus === true || p.lastAutoAppealSmartPlus === true;
    let rules;
    if (autonomy === 'notify') {
      rules = p.rules.map((r) => ({ ...r, enabled: false }));
    } else {
      const mode = autonomy === 'auto' ? 'execute' : 'proposal';
      const leavingNotify = p.autonomy === 'notify';
      rules = p.rules.map((r) => ({ ...r, mode, enabled: leavingNotify ? restore.has(r.id) : r.enabled }));
    }
    return {
      ...p,
      rules,
      alerts: { ...p.alerts, enabled: true, autoAppealSmartPlus: autonomy === 'auto' ? rememberedAutoAppeal : false },
      autonomy,
      lastEnabledRuleIds: autonomy === 'notify' ? enabledIds : p.lastEnabledRuleIds,
      lastAutoAppealSmartPlus: rememberedAutoAppeal,
    };
  });
}

// Validação/normalização das regras (usada pelo PUT /api/ads/rules).
// Campos novos SEMPRE ganham default seguro — regras antigas salvas no Neon
// não têm esses campos e precisam avaliar sem `undefined > number`.
function validateRules(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list.slice(0, 10).map((r, i) => {
    const metric = RULE_METRICS.includes(r.metric) ? r.metric : 'cpa_max';
    const out = {
      id: String(r.id || 'r' + Date.now().toString(36) + i).slice(0, 24),
      enabled: !!r.enabled,
      metric,
      // Nome/descrição legíveis (opcionais). Regras antigas sem eles seguem
      // válidas — a UI cai no rótulo técnico da métrica. `preset` marca as
      // regras semeadas de fábrica (badge na UI); some se o usuário editar
      // a regra por fora do pacote (o PUT revalida e só preserva se vier).
      ...(r.name ? { name: String(r.name).slice(0, 80) } : {}),
      ...(r.description ? { description: String(r.description).slice(0, 200) } : {}),
      ...(r.preset ? { preset: true } : {}),
      // Tag de PILOTO (camada de apresentação da dashboard): agrupa regras em
      // estratégias de gestor (protetor/escalador/horário) com intensidade.
      // Whitelist estrita — valor fora do vocabulário é descartado.
      ...(['protector', 'scaler', 'schedule'].includes(r.pilot) ? { pilot: r.pilot } : {}),
      ...(['conservador', 'normal', 'agressivo'].includes(r.intensity) ? { intensity: r.intensity } : {}),
      threshold: Math.max(0, Math.min(100000, Number(r.threshold) || 0)),
      // Default DIÁRIO (1): pedido do produto. Janela curta é ruidosa, mas os
      // pisos de volume (minClicks/minImpressions) protegem; a UI avisa < 3d.
      lookbackDays: Math.max(1, Math.min(30, parseInt(r.lookbackDays, 10) || 1)),
      action: RULE_ACTIONS.includes(r.action) ? r.action : 'pause',
      pct: Math.max(5, Math.min(50, Number(r.pct) || 20)),
      // F3 — MODO PROPOSTA: 'proposal' grava a intenção p/ aprovação humana;
      // 'execute' age direto (comportamento antigo). Default proposal — é a
      // migração implícita: regras antigas salvas sem o campo passam a propor
      // em vez de executar (quem quiser autonomia total marca execute).
      mode: r.mode === 'execute' ? 'execute' : 'proposal',
    };
    if (metric === 'ctr_min') {
      // guarda de volume: nunca pausar campanha recém-ligada com 10 impressões
      out.minImpressions = Math.max(100, Math.min(1000000, parseInt(r.minImpressions, 10) || 1000));
    }
    if (metric === 'cpa_max' || metric === 'spend_no_conv') {
      // Piso de volume OBRIGATÓRIO: ruído estatístico não é sinal. Sem isto,
      // cpa_max/spend_no_conv pausavam campanha com 3 cliques. Defaults: 30
      // cliques e 1000 impressões — regras antigas sem esses campos herdam.
      out.minClicks = Math.max(1, Math.min(1000000, parseInt(r.minClicks, 10) || 30));
      out.minImpressions = Math.max(1, Math.min(1000000, parseInt(r.minImpressions, 10) || 1000));
    }
    if (metric === 'cpm_max') {
      out.minSpend = Math.max(0.5, Math.min(100000, Number(r.minSpend) || 1));
    }
    if (metric === 'cpc_max') {
      // piso de cliques obrigatório: CPC de 2 cliques é ruído, não sinal
      out.minClicks = Math.max(1, Math.min(1000000, parseInt(r.minClicks, 10) || 30));
    }
    if (metric === 'roas_scale') {
      out.action = 'budget_up'; // escala é sempre budget_up
      out.minSales = Math.max(1, Math.min(1000, parseInt(r.minSales, 10) || 2));
      // teto absoluto OBRIGATÓRIO: sem teto válido a regra é DESATIVADA (não
      // inventamos um teto — escala sem limite é o risco nº 1 deste motor)
      const cap = Number(r.budgetCap) || 0;
      out.budgetCap = cap > 0 ? Math.min(1000000, cap) : 0;
      if (!(out.budgetCap > 0)) out.enabled = false;
    }
    if (metric === 'schedule') {
      const days = Array.isArray(r.days) ? r.days.map((d) => parseInt(d, 10)).filter((d) => d >= 0 && d <= 6) : [];
      out.days = [...new Set(days)].sort();
      out.startTime = /^\d{2}:\d{2}$/.test(String(r.startTime || '')) ? r.startTime : '09:00';
      out.endTime = /^\d{2}:\d{2}$/.test(String(r.endTime || '')) ? r.endTime : '23:00';
      out.timezone = String(r.timezone || 'Europe/Lisbon').slice(0, 40);
      out.threshold = 1; // passa o filtro de threshold>0 (schedule não usa threshold)
      if (!out.days.length) out.enabled = false;
    }
    return out;
  }).filter((r) => r.metric === 'schedule' ? r.days && r.days.length : r.threshold > 0);
}

async function auditSimulated(accId, { action, targetType, targetId, advertiserId, metadata, title }) {
  try {
    await adsOps.appendAuditEvent(accId, {
      actorType: 'system', action: action + '.simulated', targetType, targetId,
      advertiserId, reason: title || 'Simulado (dry-run)', metadata: metadata || {}
    });
  } catch (_) { /* auditoria é best-effort */ }
}

// Auditoria DURÁVEL de uma ação REAL do motor (não dry-run). Grava before/after
// em ads_audit_events — antes as ações reais iam só ao rulesLog (50 entradas em
// memória que somem no restart). É também a fonte do cap de ações/hora e do
// rollback. Devolve o evento (com id) p/ o front oferecer o botão de reverter.
async function auditReal(accId, { action, targetType, targetId, advertiserId, beforeState, afterState, reason, metadata }) {
  try {
    return await adsOps.appendAuditEvent(accId, {
      actorType: 'system', action, targetType, targetId, advertiserId,
      beforeState: beforeState || null, afterState: afterState || null,
      reason: reason || null, metadata: metadata || {},
    });
  } catch (_) { return null; } // auditoria é best-effort: nunca derruba o motor
}

// Soma o orçamento DIÁRIO total da conta a partir do espelho — base do teto de
// gasto diário (daily_spend_cap). Ignora orçamentos lifetime (não são "por dia").
function sumAccountDailyBudget(campaigns) {
  let total = 0;
  for (const c of campaigns || []) {
    if (c.budgetOwner === 'campaign') {
      const b = c.budget || {};
      if ((b.type || 'daily') !== 'lifetime') total += Number(b.amount) || 0;
      continue;
    }
    for (const s of (c.adSets || [])) {
      const b = s.budget || {};
      if ((b.type || 'daily') !== 'lifetime') total += Number(b.amount) || 0;
    }
  }
  return total;
}

// Janela de resultados de ações REAIS por conta (circuit breaker). Em memória:
// protege contra tempestade de falhas da API num runtime (ex.: Pipeboard fora
// do ar → 100% de falha → abre o breaker e o motor para de tentar naquela
// varredura). circuitBreakerOpen vinha do ads-ops-store sem call site — aqui
// ele ganha uso real.
const BREAKER_MIN_SAMPLES = 10; // amostras mínimas antes de o breaker poder abrir
const actionOutcomes = new Map(); // account+advertiser → boolean[] (true = ok)
const breakerLastAt = new Map();  // account+advertiser → ms do último resultado
const breakerHydrated = new Map(); // account+advertiser → Promise
function breakerScope(accId, advertiserId) { return String(accId) + (advertiserId ? ':' + cleanAdvertiserId(advertiserId) : ''); }

// Hidrata a janela do breaker do Redis UMA vez por conta. Sem isto, um restart
// zerava o histórico e o breaker "esquecia" uma tempestade de falhas em curso.
// A memória mais nova sempre vence (não sobrescreve resultados chegados após a
// carga). Best-effort: falha de Redis nunca quebra o motor.
function ensureBreakerHydrated(accId, advertiserId) {
  const scope = breakerScope(accId, advertiserId);
  if (breakerHydrated.has(scope)) return breakerHydrated.get(scope);
  const p = (async () => {
    try {
      const snap = await redis.loadBreakerSamples(scope);
      if (snap && Array.isArray(snap.samples) && !actionOutcomes.has(scope)) {
        actionOutcomes.set(scope, snap.samples.slice(-20));
        if (snap.at) breakerLastAt.set(scope, snap.at);
      }
    } catch (_) { /* Redis indisponível — segue com janela em memória */ }
  })();
  breakerHydrated.set(scope, p);
  return p;
}

function recordOutcome(accId, ok, advertiserId) {
  const scope = breakerScope(accId, advertiserId);
  const arr = actionOutcomes.get(scope) || [];
  arr.push(!!ok);
  while (arr.length > 20) arr.shift();
  actionOutcomes.set(scope, arr);
  breakerLastAt.set(scope, Date.now());
  // Write-through best-effort: persiste a janela para sobreviver a restart.
  redis.saveBreakerSamples(scope, arr).catch(() => {});
}
function breakerOpen(accId, policy, advertiserId) {
  return adsOps.circuitBreakerOpen(actionOutcomes.get(breakerScope(accId, advertiserId)) || [], policy.circuitBreakerErrorPct, BREAKER_MIN_SAMPLES);
}
// Estado observável do circuit breaker por conta — o painel mostra "aberto/
// fechado", a taxa de falha da janela e quantas amostras já entraram. É a MESMA
// janela em memória que o motor usa para decidir parar (nada paralelo). Aceita a
// política p/ refletir o threshold configurado na conta (default 25%).
function getBreakerState(accId, policy, advertiserId) {
  const scope = breakerScope(accId, advertiserId);
  const thresholdPct = Math.min(100, Math.max(1, Number(policy && policy.circuitBreakerErrorPct) || 25));
  const samples = actionOutcomes.get(scope) || [];
  const failures = samples.filter((ok) => !ok).length;
  const lastAt = breakerLastAt.get(scope) || 0;
  return {
    open: adsOps.circuitBreakerOpen(samples, thresholdPct, BREAKER_MIN_SAMPLES),
    samples: samples.length,
    failures,
    failureRatePct: samples.length ? Math.round((failures / samples.length) * 100) : 0,
    thresholdPct,
    minimumSamples: BREAKER_MIN_SAMPLES,
    // faltam amostras p/ o breaker poder abrir (abaixo do mínimo ele NUNCA abre)
    warmingUp: samples.length < BREAKER_MIN_SAMPLES,
    lastOutcomeAt: lastAt ? new Date(lastAt).toISOString() : null,
  };
}

// ── Atribuição por campanha (vendas reais × campanha) ───────────────────────
// Movida do ads-routes.js — leads comprados com utm_campaign=<id numérico>
// viram receita/vendas POR campanha (base do roas_min e do roas_scale).
function computeAttribution(accId, fromDate, toDate) {
  const byCampaign = {};
  const unattributed = { revenueCents: 0, sales: 0 };
  if (typeof stats.getStats !== 'function') return { byCampaign, unattributed };
  const snap = stats.getStats(accId) || {};
  (snap.leads || []).forEach((l) => {
    if (l.stage !== 'purchased' || !l.convertedAt) return;
    const day = String(l.convertedAt).slice(0, 10);
    if (day < fromDate || day > toDate) return;
    const src = String((l.utm || {}).source || '').toLowerCase();
    const isTikTok = src === 'tiktok' || !!l.ttclid;
    if (!isTikTok) return;
    const cents = Number(l.reportedAmount) || 0;
    const camp = String((l.utm || {}).campaign || '').trim();
    if (/^\d{5,30}$/.test(camp)) {
      if (!byCampaign[camp]) byCampaign[camp] = { revenueCents: 0, sales: 0 };
      byCampaign[camp].revenueCents += cents;
      byCampaign[camp].sales += 1;
    } else {
      unattributed.revenueCents += cents;
      unattributed.sales += 1;
    }
  });
  return { byCampaign, unattributed };
}

// ── Árvore para varredura: espelho Neon com guarda de frescor ───────────────
// force=true (rota manual) cai para a API viva — o usuário pediu AGORA.
async function treeForSweep(accId, advertiserId, { fromDate, toDate, status, force }) {
  if (!force && cache.enabled) {
    const st = await cache.getSyncState(accId, advertiserId).catch(() => null);
    const last = st && st.last_synced_at ? new Date(st.last_synced_at).getTime() : 0;
    if (!last || Date.now() - last > FRESHNESS_MS) {
      return { stale: true, campaigns: [] }; // dado velho: melhor não agir do que agir errado
    }
    const tree = await cache.readTree(accId, advertiserId, { fromDate, toDate, status });
    if (tree) return { stale: false, campaigns: tree.campaigns || [] };
  }
  const tree = await provider.getDashboardTree(accId, { advertiserId, status, fromDate, toDate });
  return { stale: false, campaigns: tree.campaigns || [] };
}

function isoDay(d) { return d.toISOString().slice(0, 10); }

// ── Auto-appeal de anúncio Smart+ reprovado (opt-in, é AÇÃO real) ───────────
// Diferente do resto do runAlertSweep (que só notifica), recorrer é uma escrita
// na plataforma: obedece kill switch e Modo teste (dry-run) da política, com
// deduplicação por INCIDENTE/grupo p/ nunca recorrer duas vezes da mesma
// reprovação. O estado é gravado na central durável antes da chamada externa.
async function autoAppealRejectedSmartPlus(accId, advertiserId, rejectedAds) {
  const policy = await adsOps.getSafetyPolicy(accId);
  if (policy.killSwitch) {
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Kill switch ATIVO: auto-recurso de Smart+ abortado' });
    return;
  }
  const dryRun = !!policy.dryRun;
  for (const a of rejectedAds) {
    const adId = String(a.adId || '');
    const itemName = String(a.adGroupName || a.adName || a.name || a.adGroupId || adId);
    if (!adId || (a.campaignKind && a.campaignKind !== 'smart_plus')) continue;
    const incidentId = String(a.id || a.adGroupId || adId);
    const key = scopedStateKey(advertiserId, 'appeal:' + incidentId);
    const failureKey = scopedStateKey(advertiserId, 'appeal-failure:' + incidentId);
    if (await underCooldown(accId, key, APPEAL_COOLDOWN_MS)) continue;
    if (await underCooldown(accId, failureKey, APPEAL_RETRY_MS)) continue;
    let reserved = null;
    if (a.id && !dryRun) {
      reserved = await adsOps.reserveAdAppeal(accId, a.id, { auto: true });
      if (!reserved) continue;
    }
    const reason = reserved
      ? reserved.appealText
      : adsOps.buildAdAppealText(a);
    try {
      if (dryRun) {
        await auditSimulated(accId, {
          action: 'smart_plus_appeal', targetType: 'adgroup', targetId: a.adGroupId || adId, advertiserId,
          metadata: { auto: true, adId }, title: 'Auto-recurso do grupo Smart+ "' + itemName + '"',
        });
      } else {
        await provider.appealSmartPlusAd(advertiserId, adId, reason, reserved && reserved.appealAttachments);
        if (a.id) await adsOps.finishAdAppeal(accId, a.id, { ok: true });
        await auditReal(accId, {
          action: 'smart_plus_appeal', targetType: 'adgroup', targetId: a.adGroupId || adId, advertiserId,
          reason: 'Auto-recurso: ' + reason, metadata: { auto: true, adId, adName: a.adName || a.name || '' },
        });
      }
      // Só marca o cooldown após sucesso (dry-run também marca: a simulação não
      // deve re-simular o mesmo anúncio a cada varredura).
      await markFired(accId, key, 'appeal', { auto: true });
      stats.logEvent('info', { acc: accId, title: '[tiktok-ads] ' + (dryRun ? '[simulado] ' : '') + 'Auto-recurso enviado para o grupo Smart+ "' + itemName + '"' });
    } catch (e) {
      if (a.id) await adsOps.finishAdAppeal(accId, a.id, { ok: false, error: e && e.message });
      // Evita martelar o endpoint de recurso em toda varredura; o usuário ainda
      // pode tentar manualmente na central durante esta janela.
      await markFired(accId, failureKey, 'appeal_failure', { auto: true, error: String(e && e.message || '').slice(0, 160) }).catch(() => {});
      stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Auto-recurso do Smart+ "' + itemName + '" FALHOU: ' + String(e && e.message ? e.message : 'erro').slice(0, 120) });
      if (!dryRun) {
        sendPushcut('Aprovada', {
          title: 'Automação do TikTok Ads falhou',
          text: 'Não consegui recorrer do grupo Smart+ "' + itemName + '". Revise em Automações.',
          sound: 'system',
        }, accId, {
          event: 'ads_failure', priority: 'critical', dedupeKey: 'ads:appeal-failed:' + adId,
        }).catch(() => {});
      }
    }
  }
}

// ── Alertas (não agem — só notificam) ───────────────────────────────────────
async function runAlertSweep(accId, { force, advertiserId: advertiserHint } = {}) {
  const advertiserId = cleanAdvertiserId(advertiserHint) || await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { findings: [], skipped: true };
  const cfg = getAlertCfg(accId, advertiserId);
  if (!cfg.enabled && !force) return { findings: [], skipped: true };
  if (!provider.enabled) return { findings: [], skipped: true };

  const to = new Date();
  const from = new Date(to.getTime() - Math.max(1, cfg.lookbackDays) * 864e5);
  const { stale, campaigns } = await treeForSweep(accId, advertiserId, {
    fromDate: isoDay(from), toDate: isoDay(to), status: 'active', force,
  });
  if (stale) return { findings: [], stale: true };

  const findings = [];
  campaigns.forEach((c) => {
    const m = c.metrics || {};
    const spend = Number(m.spend) || 0;
    const conv = Number(m.conversions) || 0;
    const name = c.campaignName || c.platformCampaignId;
    if (cfg.spendNoConv > 0 && conv === 0 && spend >= cfg.spendNoConv) {
      findings.push({
        rule: 'spend_no_conv', campaignId: c.platformCampaignId, campaignName: name,
        spend: +spend.toFixed(2), conversions: 0,
        text: '"' + name + '" gastou ' + spend.toFixed(2) + ' ' + (c.currency || '') + ' nos últimos ' + cfg.lookbackDays + 'd sem nenhuma conversão.'
      });
    }
    if (cfg.cpaMax > 0 && conv > 0 && spend / conv > cfg.cpaMax) {
      findings.push({
        rule: 'cpa_max', campaignId: c.platformCampaignId, campaignName: name,
        spend: +spend.toFixed(2), conversions: conv, cpa: +(spend / conv).toFixed(2),
        text: '"' + name + '" está com CPA de ' + (spend / conv).toFixed(2) + ' ' + (c.currency || '') + ' (teto: ' + cfg.cpaMax + ').'
      });
    }
  });

  // Criativo reprovado: a leitura acima filtra 'active', então campanhas com
  // revisão rejeitada ficam de fora — segunda leitura do MESMO espelho (barata,
  // zero chamadas à API) só para este aviso. O gestor descobre a reprovação
  // pelo push, não ao abrir o Ads Manager horas depois.
  if (cfg.rejectedAds) {
    const { campaigns: rejected } = await treeForSweep(accId, advertiserId, {
      fromDate: isoDay(from), toDate: isoDay(to), status: 'rejected', force,
    });
    // O sincronizador alimenta a central com a árvore COMPLETA. Nunca grave
    // aqui a lista parcial filtrada por status: campanhas pausadas com anúncio
    // reprovado ficariam de fora e seriam marcadas como resolvidas por engano.
    // A central agrupa por grupo e evita dois alertas para a mesma reprovação.
    let centralUsada = false;
    try {
      const open = await adsOps.listAdRejections(accId, { advertiserId, status: 'open' });
      centralUsada = open.length > 0 || !(rejected || []).length;
      open.forEach((item) => findings.push({
        rule: item.campaignKind === 'smart_plus' ? 'smart_plus_rejected' : 'rejected_ads',
        campaignId: item.campaignId || item.adId,
        campaignName: item.campaignName || item.adName,
        text: (item.campaignKind === 'smart_plus' ? 'Smart+: o grupo ' : 'O grupo ')
          + '"' + (item.adGroupName || item.adName) + '" foi REPROVADO — corrija ou acompanhe o recurso na central.',
      }));
      const smart = open.filter((item) => item.campaignKind === 'smart_plus');
      if (cfg.autoAppealSmartPlus && smart.length && typeof provider.appealSmartPlusAd === 'function') {
        await autoAppealRejectedSmartPlus(accId, advertiserId, smart);
      }
    } catch (_) { /* central indisponível — alertas de campanha já foram gerados */ }
    if (!centralUsada) {
      (rejected || []).forEach((c) => {
        const name = c.campaignName || c.platformCampaignId;
        findings.push({
          rule: 'rejected_ads', campaignId: c.platformCampaignId, campaignName: name,
          text: '"' + name + '" teve anúncio REPROVADO na revisão do TikTok — corrija o criativo ou recorra.',
        });
      });
    }
  }

  const freshFindings = [];
  for (const f of findings) {
    const key = scopedStateKey(advertiserId, 'alert:' + f.campaignId + ':' + f.rule);
    if (await underCooldown(accId, key, ALERT_COOLDOWN_MS)) { f.muted = true; continue; }
    await markFired(accId, key, 'alert', { rule: f.rule });
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] ' + f.text });
    freshFindings.push(f);
  }
  // Uma varredura gera no máximo UM push. Os detalhes completos continuam no
  // painel; o iPhone recebe só o resumo que pede atenção.
  if (freshFindings.length) {
    const ordered = freshFindings.slice().sort((a, b) => Number(/rejected/i.test(b.rule)) - Number(/rejected/i.test(a.rule)));
    const first = ordered[0];
    const rejected = ordered.some((f) => /rejected/i.test(f.rule));
    const extra = ordered.length > 1 ? ' +' + (ordered.length - 1) + ' outro(s) alerta(s) no painel.' : '';
    sendPushcut('Aprovada', {
      title: rejected ? 'Anúncio reprovado no TikTok Ads' : 'TikTok Ads precisa de atenção',
      text: first.text + extra,
      sound: 'system',
    }, accId, {
      event: rejected ? 'ads_rejected' : 'ads_attention',
      priority: rejected ? 'critical' : 'normal',
      dedupeKey: 'ads:performance:' + first.campaignId + ':' + first.rule,
    }).catch(() => {});
  }
  return { findings, checkedAt: new Date().toISOString() };
}

// ── Execução de UMA ação de regra (pause / budget ±) ────────────────────────
// F3: extraída do corpo do sweep para o approve de proposta executar pelo
// MESMO caminho (mesmos provider calls, mesmos before/after) — sem reimplementar
// e divergir. Estados são computados de forma pura (proposta usa sem executar).
function computeActionStates(action, campaign, plan) {
  if (action === 'pause' || action === 'activate') {
    const target = action === 'pause' ? 'paused' : 'active';
    return {
      beforeState: { kind: 'status', level: 'campaign', id: campaign.platformCampaignId, value: campaign.status || 'active' },
      afterState: { kind: 'status', level: 'campaign', id: campaign.platformCampaignId, value: target },
    };
  }
  const changes = (plan && plan.changes) || [];
  return {
    beforeState: { kind: 'budget', targets: changes.map((ch) => ({ level: ch.targetType || 'adgroup', id: ch.targetId || ch.adGroupId, amount: ch.cur, type: ch.type })) },
    afterState: { kind: 'budget', targets: changes.map((ch) => ({ level: ch.targetType || 'adgroup', id: ch.targetId || ch.adGroupId, amount: ch.amount, type: ch.type })) },
  };
}

// Roteia a mudança de status ao provider certo pela origem da campanha: Smart+
// tem endpoint próprio (setSmartPlusCampaignStatus); leilão usa setCampaignStatus.
async function setCampaignStatusByKind(campaign, advertiserId, cid, status) {
  if (campaign && campaign.campaignKind === 'smart_plus') {
    return provider.setSmartPlusCampaignStatus(advertiserId, [cid], status);
  }
  return provider.setCampaignStatus(advertiserId, [cid], status);
}

async function executeRuleAction({ advertiserId, action, campaign, plan, dryRun }) {
  const { beforeState, afterState } = computeActionStates(action, campaign, plan);
  const prefix = dryRun ? '[simulado] ' : '';
  // Smart+ usa endpoints próprios para status e orçamento. O plano preserva o
  // dono do orçamento: campanha em CBO e grupo em ABO.
  const isSmartPlus = campaign.campaignKind === 'smart_plus';
  if (action === 'pause' || action === 'activate') {
    const status = action === 'pause' ? 'paused' : 'active';
    if (!dryRun) await setCampaignStatusByKind(campaign, advertiserId, campaign.platformCampaignId, status);
    const result = action === 'pause'
      ? (isSmartPlus ? 'campanha Smart+ pausada' : 'campanha pausada')
      : (isSmartPlus ? 'campanha Smart+ reativada' : 'campanha reativada');
    return { ok: true, result: prefix + result, beforeState, afterState };
  }
  const { pct, cap, capped, changes } = plan;
  let changed = 0;
  for (const ch of changes) {
    if (!dryRun) {
      const targetType = ch.targetType || (ch.campaignId ? 'campaign' : 'adgroup');
      const targetId = ch.targetId || ch.campaignId || ch.adGroupId;
      if (targetType === 'campaign') {
        if (isSmartPlus) await provider.updateSmartPlusCampaign(advertiserId, targetId, { budget: { amount: ch.amount, type: ch.type } });
        else await provider.updateCampaign(advertiserId, targetId, { budget: { amount: ch.amount, type: ch.type } });
      } else if (isSmartPlus) {
        await provider.updateSmartPlusAdGroup(advertiserId, targetId, { budget: { amount: ch.amount, type: ch.type } });
      } else {
        await provider.updateAdGroup(advertiserId, targetId, { budget: { amount: ch.amount, type: ch.type } });
      }
    }
    changed += 1;
  }
  let result = prefix + 'orçamento ' + (action === 'budget_up' ? '+' : '-') + pct + '% em ' + changed + ' nível(is)'
    + (capped ? ' (teto ' + cap + ' aplicado em ' + capped + ')' : '');
  if (!changed && capped) result = prefix + 'todos os grupos já no teto de ' + cap;
  return { ok: changed > 0, result, beforeState, afterState };
}

// ── Avaliação de regra (PURA) ───────────────────────────────────────────────
// Extraída do corpo do sweep para que o BACKTEST (simulação "e se") avalie pelo
// MESMO caminho — mesmos thresholds, pisos de volume e guardas — sem executar,
// sem consumir cooldown e sem reimplementar (e divergir) a lógica.
function metricsContext(c, attribution) {
  const m = c.metrics || {};
  const spend = Number(m.spend) || 0;
  const conv = Number(m.conversions) || 0;
  const impressions = Number(m.impressions) || 0;
  const clicks = Number(m.clicks) || 0;
  const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : null;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
  const attr = (attribution.byCampaign || {})[c.platformCampaignId] || { revenueCents: 0, sales: 0 };
  const roas = spend > 0 ? (attr.revenueCents / 100) / spend : null;
  // roas_min só age com venda atribuída em ALGUMA campanha da conta (ou nesta):
  // ROAS "0" sem nenhuma venda pode ser só atraso de webhook.
  const anySales = Object.values(attribution.byCampaign || {}).some((a) => a.sales > 0);
  return { spend, conv, impressions, clicks, ctrPct, cpm, attr, roas, anySales };
}

function evaluateRule(r, ctx) {
  const { spend, conv, impressions, clicks, ctrPct, cpm, attr, roas, anySales } = ctx;
  if (r.metric === 'cpa_max' && r.threshold > 0 && conv > 0 && spend / conv > r.threshold
    && impressions >= (r.minImpressions || 1000) && clicks >= (r.minClicks || 30)) {
    return { hit: true, detail: 'CPA ' + (spend / conv).toFixed(2) + ' > teto ' + r.threshold + ' (' + clicks + ' cliques, ' + impressions + ' impr.)' };
  }
  if (r.metric === 'spend_no_conv' && r.threshold > 0 && conv === 0 && spend >= r.threshold
    && impressions >= (r.minImpressions || 1000) && clicks >= (r.minClicks || 30)) {
    return { hit: true, detail: 'gastou ' + spend.toFixed(2) + ' sem conversão (' + clicks + ' cliques, ' + impressions + ' impr.)' };
  }
  if (r.metric === 'roas_min' && r.threshold > 0 && spend > 0 && roas !== null && roas < r.threshold) {
    if (anySales || attr.sales > 0) return { hit: true, detail: 'ROAS ' + roas.toFixed(2) + ' < piso ' + r.threshold };
    return { hit: false };
  }
  if (r.metric === 'ctr_min' && r.threshold > 0 && ctrPct !== null
    && impressions >= (r.minImpressions || 1000) && ctrPct < r.threshold) {
    return { hit: true, detail: 'CTR ' + ctrPct.toFixed(2) + '% < mínimo ' + r.threshold + '% (' + impressions + ' impressões)' };
  }
  if (r.metric === 'cpm_max' && r.threshold > 0 && cpm !== null
    && spend >= (r.minSpend || 1) && cpm > r.threshold) {
    return { hit: true, detail: 'CPM ' + cpm.toFixed(2) + ' > teto ' + r.threshold };
  }
  if (r.metric === 'cpc_max' && r.threshold > 0 && clicks >= (r.minClicks || 30)
    && spend / clicks > r.threshold) {
    return { hit: true, detail: 'CPC ' + (spend / clicks).toFixed(2) + ' > teto ' + r.threshold + ' (' + clicks + ' cliques)' };
  }
  if (r.metric === 'roas_scale' && r.threshold > 0 && roas !== null
    && attr.sales >= (r.minSales || 2) && roas >= r.threshold) {
    return { hit: true, detail: 'ROAS ' + roas.toFixed(2) + ' ≥ ' + r.threshold + ' com ' + attr.sales + ' venda(s) — escalando' };
  }
  return { hit: false };
}

// Plano de orçamento (PURO) de uma regra budget_up/budget_down sobre a campanha.
// maxBudgetChangePct vem da política (o motor a passa; o backtest também) para o
// passo respeitar o teto de variação configurado. Não toca a plataforma.
function computeBudgetPlan(r, c, maxBudgetChangePct) {
  const pctRaw = Math.max(5, Math.min(50, Number(r.pct) || 20));
  const pct = Math.min(pctRaw, Number.isFinite(maxBudgetChangePct) ? maxBudgetChangePct : pctRaw);
  const factor = r.action === 'budget_up' ? 1 + pct / 100 : 1 - pct / 100;
  const cap = r.metric === 'roas_scale' ? Number(r.budgetCap) || 0 : 0;
  const changes = []; let capped = 0; let delta = 0;
  const targets = c.budgetOwner === 'campaign'
    ? [{ targetType: 'campaign', targetId: c.platformCampaignId, budget: c.budget || {} }]
    : (c.adSets || []).slice(0, 10).map((set) => ({
      targetType: 'adgroup', targetId: set.platformAdSetId || set._id, budget: set.budget || {},
    }));
  for (const target of targets) {
    const cur = Number(target.budget.amount) || 0;
    if (!(cur > 0) || !target.targetId) continue;
    let amount = Math.max(1, +(cur * factor).toFixed(2));
    if (cap > 0 && amount > cap) {
      if (cur >= cap) { capped += 1; continue; } // já no teto: não toca
      amount = cap; capped += 1;
    }
    const type = target.budget.type === 'lifetime' ? 'lifetime' : 'daily';
    changes.push({
      targetType: target.targetType,
      targetId: target.targetId,
      campaignId: target.targetType === 'campaign' ? target.targetId : undefined,
      adGroupId: target.targetType === 'adgroup' ? target.targetId : undefined,
      cur, amount, type,
    });
    if (type !== 'lifetime') delta += amount - cur;
  }
  return { pct, cap, capped, changes, delta };
}

// ── Regras (agem: pause / budget ±) ─────────────────────────────────────────
async function runRulesSweep(accId, { force, advertiserId: advertiserHint } = {}) {
  if (!provider.enabled) return { executed: [], skipped: true };
  const advertiserId = cleanAdvertiserId(advertiserHint) || await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };
  const rules = getRules(accId, advertiserId).filter((r) => r.enabled && r.metric !== 'schedule');
  if (!rules.length) return { executed: [], skipped: true };

  // GUARDA 1 — a PRIMEIRA de todas, antes até do dry-run: kill switch.
  // Com ele ativo o motor não avalia nem age em NADA.
  const policy = await adsOps.getSafetyPolicy(accId);
  if (policy.killSwitch) {
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Kill switch ATIVO: varredura de regras abortada (zero ações)' });
    return { executed: [], killSwitch: true };
  }
  // Restaura a janela do breaker do Redis antes de avaliar — assim uma sequência
  // de falhas de antes do restart continua contando para abrir o breaker.
  await ensureBreakerHydrated(accId, advertiserId);

  const dryRun = !!policy.dryRun;
  const to = new Date();
  const maxLookback = Math.max(...rules.map((r) => r.lookbackDays || 1), 1);
  const fromDate = isoDay(new Date(to.getTime() - maxLookback * 864e5));
  const toDate = isoDay(to);
  const { stale, campaigns } = await treeForSweep(accId, advertiserId, {
    fromDate, toDate, status: 'active', force,
  });
  if (stale) {
    stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Varredura de regras adiada: espelho com mais de 15min' });
    return { executed: [], stale: true };
  }
  const attribution = computeAttribution(accId, fromDate, toDate);

  // GUARDA — cap global de ações reais/hora (durável, anti-loop). Começa com o
  // que já foi feito na última hora (do ads_audit_events) e cresce a cada ação
  // real deste sweep. maxActionsPerHour=0 desliga.
  let actionsThisHour = policy.maxActionsPerHour > 0 ? await adsOps.countRecentEngineActions(accId, 3600e3, advertiserId) : 0;
  // Orçamento diário corrente da conta (base do teto de gasto). Cresce conforme
  // aplicamos budget_up de verdade, para o teto valer dentro do próprio sweep.
  let accountDailyBudget = sumAccountDailyBudget(campaigns);

  const executed = [];
  let stop = false; // cap/breaker atingido → para de agir no resto do sweep
  for (const c of campaigns) {
    if (stop) break;
    const ctx = metricsContext(c, attribution);
    const name = c.campaignName || c.platformCampaignId;

    for (const r of rules) {
      if (stop) break;
      // GUARDA — circuit breaker: muitas falhas reais seguidas → para de tentar.
      if (!dryRun && breakerOpen(accId, policy, advertiserId)) {
        stop = true;
        stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Circuit breaker ABERTO (≥' + policy.circuitBreakerErrorPct + '% de falhas): motor interrompido nesta varredura' });
        sendPushcut('Aprovada', { title: 'Automação pausada por segurança', text: 'Muitas ações falharam em sequência. O motor parou para proteger a conta.', sound: 'system' }, accId, { event: 'ads_breaker', priority: 'critical', dedupeKey: 'ads:breaker:' + advertiserId }).catch(() => {});
        break;
      }
      // GUARDA — cap de ações/hora (anti-loop: pausa→reativa→repete). Só conta
      // ações reais; dry-run nunca trava.
      if (!dryRun && policy.maxActionsPerHour > 0 && actionsThisHour >= policy.maxActionsPerHour) {
        stop = true;
        stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido: motor parado (anti-loop)' });
        sendPushcut('Aprovada', { title: 'Limite da automação atingido', text: 'O motor parou após ' + policy.maxActionsPerHour + ' ações nesta hora para evitar repetição.', sound: 'system' }, accId, { event: 'ads_cap', priority: 'critical', dedupeKey: 'ads:cap:' + advertiserId }).catch(() => {});
        break;
      }

      const { hit, detail } = evaluateRule(r, ctx);
      if (!hit) continue;

      // Pré-computa alterações de orçamento ANTES de consumir cooldown: uma
      // recusa por teto de gasto não deve "gastar" o cooldown de 12h da regra.
      // maxBudgetChangePct da política vale para o MOTOR (antes só valia em
      // bulk/jobs via assertMutationAllowed) — computeBudgetPlan aplica o teto.
      let plan = null;
      if (r.action !== 'pause') {
        plan = computeBudgetPlan(r, c, policy.maxBudgetChangePct);
      }

      // GUARDA — teto de gasto diário: recusa budget_up que ultrapasse o teto.
      // NÃO consome cooldown (a regra volta a valer quando houver folga).
      if (plan && r.action === 'budget_up' && policy.dailySpendCap != null && plan.delta > 0
        && (accountDailyBudget + plan.delta) > policy.dailySpendCap) {
        const refused = {
          at: new Date().toISOString(), ruleId: r.id, metric: r.metric, action: r.action,
          campaignId: c.platformCampaignId, campaignName: name, detail, ok: false, simulated: dryRun,
          result: 'recusado: teto de gasto diário ' + policy.dailySpendCap + ' seria ultrapassado (atual ' + accountDailyBudget.toFixed(2) + ' + ' + plan.delta.toFixed(2) + ')',
        };
        executed.push(refused);
        stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Ação RECUSADA pelo teto de gasto diário — "' + name + '": ' + refused.result });
        await auditReal(accId, {
          action: 'rule_action.refused', targetType: 'campaign', targetId: c.platformCampaignId, advertiserId,
          reason: refused.result, metadata: { ruleId: r.id, metric: r.metric, action: r.action, dailySpendCap: policy.dailySpendCap, delta: plan.delta, accountDailyBudget },
        });
        continue;
      }

      const cooldownMs = r.metric === 'roas_scale' ? SCALE_COOLDOWN_MS : RULE_COOLDOWN_MS;
      const key = scopedStateKey(advertiserId, 'rule:' + c.platformCampaignId + ':' + r.id);
      if (await underCooldown(accId, key, cooldownMs)) continue;
      await markFired(accId, key, 'rule', { metric: r.metric, action: r.action });

      // F3 — MODO PROPOSTA (default): grava a intenção e NÃO chama o provider.
      // Vem DEPOIS de hit + plan + recusa por teto + cooldown de propósito:
      // o cooldown É consumido na proposta — sem isso cada sweep re-proporia
      // a mesma ação a cada 10min. Dry-run tem precedência (simula, abaixo).
      // Cap/hora e circuit breaker NÃO contam propostas: nada foi executado.
      const mode = r.mode === 'execute' ? 'execute' : 'proposal';
      if (!dryRun && mode === 'proposal') {
        const states = computeActionStates(r.action, c, plan);
        const created = await adsOps.createRuleProposal(accId, {
          ruleId: r.id, metric: r.metric, action: r.action, advertiserId,
          campaignId: c.platformCampaignId, campaignName: name, detail,
          plan: { ...(plan || {}), ...states },
        });
        const pEntry = {
          at: new Date().toISOString(), ruleId: r.id, metric: r.metric,
          action: r.action, campaignId: c.platformCampaignId, campaignName: name,
          detail, ok: true, proposed: true,
          result: created ? 'proposta criada — aguardando aprovação' : 'proposta já pendente para esta campanha',
          ...(created ? { proposalId: created.id } : {}),
        };
        executed.push(pEntry);
        if (created) {
          stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Proposta criada (aguardando aprovação): ' + detail + ' — "' + name + '"' });
          sendPushcut('Aprovada', { title: 'Automação aguardando você', text: 'Sugestão: ' + (r.action === 'pause' ? 'pausar' : 'ajustar o orçamento de') + ' "' + name + '". Revise no painel.', sound: 'system' }, accId, { event: 'ads_proposal', priority: 'normal', dedupeKey: 'ads:proposal:' + created.id }).catch(() => {});
          await auditReal(accId, {
            action: 'rule_proposal.created', targetType: 'campaign', targetId: c.platformCampaignId, advertiserId,
            reason: 'Proposta: ' + detail,
            metadata: { proposalId: created.id, ruleId: r.id, metric: r.metric, action: r.action },
          });
        }
        continue;
      }

      const entry = {
        at: new Date().toISOString(), ruleId: r.id, metric: r.metric,
        action: r.action, campaignId: c.platformCampaignId, campaignName: name,
        detail, ok: false, simulated: dryRun,
      };
      let beforeState = null; let afterState = null;
      try {
        const done = await executeRuleAction({ advertiserId, action: r.action, campaign: c, plan, dryRun });
        entry.ok = done.ok;
        entry.result = done.result;
        beforeState = done.beforeState;
        afterState = done.afterState;
        // orçamento da conta cresce (só quando aplicado de verdade)
        if (entry.ok && !dryRun && r.action === 'budget_up') accountDailyBudget += plan.delta;
        // AUDITORIA DURÁVEL de toda ação real + mantém o contrato das simuladas.
        if (entry.ok) {
          if (dryRun) {
            await auditSimulated(accId, {
              action: 'rule_action', targetType: 'campaign', targetId: c.platformCampaignId, advertiserId,
              metadata: { ruleId: r.id, metric: r.metric, action: r.action, detail, beforeState, afterState },
              title: 'Regra automática: ' + entry.result,
            });
          } else {
            const ev = await auditReal(accId, {
              action: 'rule_action', targetType: 'campaign', targetId: c.platformCampaignId, advertiserId,
              beforeState, afterState, reason: 'Regra automática: ' + detail,
              metadata: { ruleId: r.id, metric: r.metric, action: r.action, detail },
            });
            if (ev && ev.id) entry.auditId = ev.id; // o front usa p/ oferecer rollback
          }
        }
      } catch (e) {
        entry.result = 'falhou: ' + (e && e.message ? e.message.slice(0, 120) : 'erro');
        // DEAD-LETTER: ação real que falhou não pode sumir no log. Persiste a
        // intenção (plan + estados) para inspeção e reprocessamento. Best-effort:
        // nunca re-lança. Dry-run e proposta não entram (nada foi executado).
        if (!dryRun) {
          const states = computeActionStates(r.action, c, plan);
          adsOps.addActionDeadLetter(accId, {
            ruleId: r.id, metric: r.metric, action: r.action, advertiserId,
            campaignId: c.platformCampaignId, campaignName: name, detail,
            plan: { ...(plan || {}), ...states },
            error: e && e.message ? e.message.slice(0, 300) : 'erro',
          }).catch(() => {});
        }
      }
      if (!dryRun) recordOutcome(accId, entry.ok, advertiserId); // alimenta o circuit breaker
      if (entry.ok && !dryRun) actionsThisHour += 1;      // conta p/ o cap/hora
      executed.push(entry);
      stats.logEvent(entry.ok ? 'info' : 'warn', { acc: accId, title: '[tiktok-ads] Regra ' + (entry.ok ? 'executada' : 'FALHOU') + ': ' + entry.result + ' — "' + name + '" (' + detail + ')' });
      if (!dryRun && !entry.ok) {
        sendPushcut('Aprovada', { title: 'Ação automática falhou', text: entry.result + ' — "' + name + '". Verifique no painel.', sound: 'system' }, accId, { event: 'ads_failure', priority: 'critical', dedupeKey: 'ads:rule-failed:' + c.platformCampaignId + ':' + r.id }).catch(() => {});
      }
    }
  }
  // Propostas não mudaram nada na plataforma — não disparam sync pós-escrita.
  if (executed.some((e) => e.ok && !e.simulated && !e.proposed)) syncAfterWrite(accId, advertiserId);
  appendRulesLog(accId, executed, advertiserId);
  return { executed, checkedAt: new Date().toISOString() };
}

// ── Backtesting de regras (simulação "e se", sem agir) ──────────────────────
// Responde "o que estas regras TERIAM feito na janela?" ANTES de ativá-las.
// Lê o MESMO espelho do motor e avalia pela MESMA evaluateRule/computeBudgetPlan
// — mas nunca executa, nunca consome cooldown, nunca audita. Aceita `rules`
// (candidatas, validadas aqui) ou usa as regras salvas da conta. Ignora
// 'schedule' (dayparting não tem métrica p/ backtest). Avalia regras mesmo
// desabilitadas — o ponto do backtest é decidir se vale ligar.
async function backtestRules(accId, { rules, lookbackDays, advertiserId: advertiserHint } = {}) {
  if (!provider.enabled) return { findings: [], skipped: true, reason: 'provider desativado' };
  const advertiserId = cleanAdvertiserId(advertiserHint) || await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { findings: [], skipped: true, reason: 'sem advertiser resolvido' };

  const ruleList = (Array.isArray(rules) ? validateRules(rules) : getRules(accId, advertiserId))
    .filter((r) => r.metric !== 'schedule');
  if (!ruleList.length) return { findings: [], skipped: true, reason: 'nenhuma regra para simular' };

  const policy = await adsOps.getSafetyPolicy(accId);
  const to = new Date();
  const maxLookback = Math.max(Number(lookbackDays) || 0, ...ruleList.map((r) => r.lookbackDays || 1), 1);
  const fromDate = isoDay(new Date(to.getTime() - maxLookback * 864e5));
  const toDate = isoDay(to);

  // Backtest é sob demanda e raro: se o espelho estiver velho, força UMA leitura
  // fresca (exatidão > 1 request) — ao contrário do sweep, que pula em stale.
  let t = await treeForSweep(accId, advertiserId, { fromDate, toDate, status: 'active' });
  if (t.stale) t = await treeForSweep(accId, advertiserId, { fromDate, toDate, status: 'active', force: true });
  const campaigns = t.campaigns || [];
  const attribution = computeAttribution(accId, fromDate, toDate);

  const findings = [];
  const summary = { campaigns: campaigns.length, rules: ruleList.length, hits: 0, byAction: { pause: 0, budget_up: 0, budget_down: 0 } };
  for (const c of campaigns) {
    const ctx = metricsContext(c, attribution);
    const name = c.campaignName || c.platformCampaignId;
    for (const r of ruleList) {
      const { hit, detail } = evaluateRule(r, ctx);
      if (!hit) continue;
      summary.hits += 1;
      summary.byAction[r.action] = (summary.byAction[r.action] || 0) + 1;
      const finding = {
        ruleId: r.id, metric: r.metric, action: r.action, enabled: !!r.enabled,
        ...(r.name ? { ruleName: r.name } : {}),
        campaignId: c.platformCampaignId, campaignName: name, detail,
        spend: +ctx.spend.toFixed(2), conversions: ctx.conv,
        roas: ctx.roas != null ? +ctx.roas.toFixed(2) : null, sales: ctx.attr.sales,
      };
      if (r.action !== 'pause') {
        const plan = computeBudgetPlan(r, c, policy.maxBudgetChangePct);
        finding.projected = {
          groups: plan.changes.length, capped: plan.capped, deltaDaily: +plan.delta.toFixed(2),
          changes: plan.changes.map((ch) => ({ adGroupId: ch.adGroupId, from: ch.cur, to: ch.amount, type: ch.type })),
        };
      }
      findings.push(finding);
    }
  }
  const window = { fromDate, toDate, lookbackDays: maxLookback };
  // Histórico durável (best-effort): compara efeito de ajustes de threshold ao
  // longo do tempo. Nunca quebra o backtest se a persistência estiver off.
  let runId = null;
  try {
    const saved = await adsOps.saveBacktestRun(accId, { window, summary, findings });
    if (saved && saved.id) runId = saved.id;
  } catch (_) { /* persistência indisponível — devolve o resultado mesmo assim */ }
  return { findings, summary, window, runId, checkedAt: new Date().toISOString() };
}

// ── F3: aprovação de proposta ───────────────────────────────────────────────
// Executa uma proposta pendente pelo MESMO caminho do motor (executeRuleAction)
// com TODOS os guards: assertMutationAllowed (kill switch/política/conta
// bloqueada/idempotência), dry-run recusa (aprovação é ação real), circuit
// breaker e cap/hora contam a aprovação. Re-valida contra o estado ATUAL antes
// de tocar a plataforma — o plan foi computado até 6h atrás.
async function approveProposal(accId, proposalId) {
  const p = await adsOps.getRuleProposal(accId, proposalId);
  if (!p) { const e = new Error('Proposta não encontrada'); e.status = 404; throw e; }
  if (p.status !== 'pending') { const e = new Error('Proposta já ' + (p.status === 'expired' ? 'expirada' : 'decidida (' + p.status + ')')); e.status = 409; throw e; }

  // Guards ANTES da transição — recusa aqui deixa a proposta pendente (o
  // usuário pode aprovar de novo quando o guard liberar).
  const proposalAdvertiserId = cleanAdvertiserId(p.advertiser_id) || await provider.resolveAdvertiserId(accId);
  const policy = await adsOps.getSafetyPolicy(accId);
  adsOps.assertMutationAllowed(policy, { advertiserId: p.advertiser_id, idempotencyKey: 'proposal:' + p.id });
  if (policy.dryRun) { const e = new Error('Modo simulação (dry-run) ativo na política — desative para executar aprovações'); e.status = 409; throw e; }
  if (breakerOpen(accId, policy, proposalAdvertiserId)) { const e = new Error('Circuit breaker aberto (muitas falhas recentes) — tente mais tarde'); e.status = 409; throw e; }
  if (policy.maxActionsPerHour > 0) {
    const n = await adsOps.countRecentEngineActions(accId, 3600e3, proposalAdvertiserId);
    if (n >= policy.maxActionsPerHour) { const e = new Error('Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido — tente mais tarde'); e.status = 429; throw e; }
  }

  // Transição ATÔMICA pending→approved (carrega o TTL de 6h no WHERE): dois
  // cliques concorrentes → só um executa; proposta velha → recusada aqui.
  const approved = await adsOps.decideRuleProposal(accId, proposalId, 'approved');
  if (!approved) { const e = new Error('Proposta expirada ou já decidida'); e.status = 409; throw e; }

  const plan = approved.plan || {};
  const advertiserId = approved.advertiser_id || proposalAdvertiserId;
  const failReval = async (msg) => {
    await adsOps.markProposalExecution(accId, approved.id, false, msg);
    const e = new Error(msg); e.status = 409; throw e;
  };

  // RE-VALIDAÇÃO contra o espelho atual (cai para a API viva se o espelho
  // estiver velho — aprovação é rara e exatidão importa mais que 1 request).
  const to = new Date();
  const range = { fromDate: isoDay(new Date(to.getTime() - 2 * 864e5)), toDate: isoDay(to) };
  let t = await treeForSweep(accId, advertiserId, range);
  if (t.stale) t = await treeForSweep(accId, advertiserId, { ...range, force: true });
  const c = (t.campaigns || []).find((x) => String(x.platformCampaignId) === String(approved.campaign_id));
  if (!c) await failReval('Campanha não encontrada no estado atual — a proposta não se aplica mais');
  if (approved.action === 'pause' && c.status !== 'active') await failReval('Campanha já não está ativa — a proposta de pausa não se aplica mais');
  if (approved.action === 'activate' && c.status !== 'paused') await failReval('Campanha já não está pausada — a proposta de reativação não se aplica mais');
  if (!['pause', 'activate'].includes(approved.action)) {
    // orçamento atual precisa bater com o before da proposta (tolerância 1%):
    // se alguém mexeu no meio-tempo, aplicar o plano antigo sobrescreveria.
    const groups = new Map((c.adSets || []).map((s) => [String(s.platformAdSetId || s._id), Number((s.budget || {}).amount) || 0]));
    for (const ch of (plan.changes || [])) {
      const cur = groups.get(String(ch.adGroupId));
      if (cur == null || Math.abs(cur - ch.cur) > Math.max(0.01, ch.cur * 0.01)) {
        await failReval('Orçamento mudou desde a proposta (grupo ' + ch.adGroupId + ': era ' + ch.cur + ', hoje ' + (cur == null ? 'inexistente' : cur) + ') — regra vai reavaliar no próximo ciclo');
      }
    }
  }

  // Executa pela MESMA função do motor — nenhum caminho paralelo.
  const entry = {
    at: new Date().toISOString(), ruleId: approved.rule_id, metric: approved.metric,
    action: approved.action, campaignId: approved.campaign_id, campaignName: approved.campaign_name,
    detail: approved.detail, ok: false, approvedProposal: true,
  };
  try {
    const done = await executeRuleAction({ advertiserId, action: approved.action, campaign: c, plan, dryRun: false });
    entry.ok = done.ok;
    entry.result = done.result + ' (proposta aprovada)';
    recordOutcome(accId, done.ok, advertiserId); // alimenta o circuit breaker como qualquer ação real
    const ev = await auditReal(accId, {
      action: 'rule_proposal.approved', targetType: 'campaign', targetId: approved.campaign_id, advertiserId,
      beforeState: done.beforeState, afterState: done.afterState,
      reason: 'Proposta aprovada: ' + (approved.detail || ''),
      metadata: { proposalId: approved.id, ruleId: approved.rule_id, metric: approved.metric, action: approved.action },
    });
    if (ev && ev.id) entry.auditId = ev.id;
    await adsOps.markProposalExecution(accId, approved.id, done.ok, done.ok ? null : done.result);
    if (done.ok && plan.scheduleMarkKey) {
      if (plan.scheduleTransition === 'pause') {
        await markFired(accId, String(plan.scheduleMarkKey), 'sched', { ruleId: approved.rule_id, pausedAt: new Date().toISOString() });
      } else if (plan.scheduleTransition === 'activate') {
        await clearFired(accId, String(plan.scheduleMarkKey));
      }
    }
    if (done.ok) syncAfterWrite(accId, advertiserId);
    appendRulesLog(accId, [entry], advertiserId);
    stats.logEvent(done.ok ? 'info' : 'warn', { acc: accId, title: '[tiktok-ads] Proposta ' + (done.ok ? 'executada' : 'FALHOU') + ': ' + entry.result + ' — "' + entry.campaignName + '"' });
    return { ok: done.ok, result: entry.result, proposalId: approved.id, auditId: entry.auditId || null };
  } catch (err) {
    const msg = 'falhou: ' + String(err && err.message ? err.message : 'erro').slice(0, 200);
    recordOutcome(accId, false, advertiserId);
    await adsOps.markProposalExecution(accId, approved.id, false, msg);
    entry.result = msg;
    appendRulesLog(accId, [entry], advertiserId);
    const e = new Error(msg); e.status = 502; throw e;
  }
}

// ── Reprocessamento de dead-letter ──────────────────────────────────────────
// Reexecuta uma ação que falhou, pelo MESMO caminho do motor (executeRuleAction)
// e com os MESMOS guards da aprovação de proposta: kill switch/política, dry-run
// recusa, circuit breaker e cap/hora. Usa o `plan` gravado (before/after já
// computados). Sucesso → 'resolved'; falha → volta a 'pending' (mantém a
// entrada para nova tentativa) com o erro atualizado.
async function reprocessDeadLetter(accId, dlId) {
  const dl = await adsOps.getActionDeadLetter(accId, dlId);
  if (!dl) { const e = new Error('Item de dead-letter não encontrado'); e.status = 404; throw e; }
  if (dl.status !== 'pending') { const e = new Error('Item já ' + dl.status); e.status = 409; throw e; }

  const deadLetterAdvertiserId = cleanAdvertiserId(dl.advertiser_id) || await provider.resolveAdvertiserId(accId);
  const policy = await adsOps.getSafetyPolicy(accId);
  adsOps.assertMutationAllowed(policy, { advertiserId: dl.advertiser_id, idempotencyKey: 'deadletter:' + dl.id });
  if (policy.dryRun) { const e = new Error('Modo simulação (dry-run) ativo — desative para reprocessar'); e.status = 409; throw e; }
  if (breakerOpen(accId, policy, deadLetterAdvertiserId)) { const e = new Error('Circuit breaker aberto (muitas falhas recentes) — tente mais tarde'); e.status = 409; throw e; }
  if (policy.maxActionsPerHour > 0) {
    const n = await adsOps.countRecentEngineActions(accId, 3600e3, deadLetterAdvertiserId);
    if (n >= policy.maxActionsPerHour) { const e = new Error('Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido — tente mais tarde'); e.status = 429; throw e; }
  }

  const plan = dl.plan || {};
  const advertiserId = dl.advertiser_id || deadLetterAdvertiserId;
  // Reconstrói o "campaign" mínimo que executeRuleAction consome (id + status).
  const campaign = { platformCampaignId: dl.campaign_id, campaignName: dl.campaign_name, status: 'active' };
  try {
    const done = await executeRuleAction({ advertiserId, action: dl.action, campaign, plan, dryRun: false });
    recordOutcome(accId, done.ok, advertiserId); // alimenta o circuit breaker como qualquer ação real
    if (done.ok) {
      await auditReal(accId, {
        action: 'rule_action', targetType: 'campaign', targetId: dl.campaign_id, advertiserId,
        beforeState: done.beforeState, afterState: done.afterState,
        reason: 'Dead-letter reprocessado: ' + (dl.detail || ''),
        metadata: { deadLetterId: dl.id, ruleId: dl.rule_id, metric: dl.metric, action: dl.action, reprocessed: true },
      });
      await adsOps.markActionDeadLetter(accId, dl.id, 'resolved', { incrementAttempt: true });
      syncAfterWrite(accId, advertiserId);
      stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Dead-letter reprocessado com sucesso: ' + done.result + ' — "' + (dl.campaign_name || dl.campaign_id) + '"' });
      return { ok: true, result: done.result, deadLetterId: dl.id, status: 'resolved' };
    }
    // provider respondeu mas nada mudou (ex.: já no teto) — trata como falha lógica
    await adsOps.markActionDeadLetter(accId, dl.id, 'pending', { error: done.result, incrementAttempt: true });
    return { ok: false, result: done.result, deadLetterId: dl.id, status: 'pending' };
  } catch (err) {
    const msg = 'falhou: ' + String(err && err.message ? err.message : 'erro').slice(0, 200);
    recordOutcome(accId, false, advertiserId);
    await adsOps.markActionDeadLetter(accId, dl.id, 'pending', { error: msg, incrementAttempt: true });
    const e = new Error(msg); e.status = 502; throw e;
  }
}

// Descarta (não reprocessa) uma entrada pendente — o gestor decidiu que a ação
// não é mais desejada. Transição pending→discarded.
async function discardDeadLetter(accId, dlId) {
  const row = await adsOps.markActionDeadLetter(accId, dlId, 'discarded');
  if (!row) { const e = new Error('Item de dead-letter não encontrado ou já resolvido'); e.status = 404; throw e; }
  return { ok: true, deadLetterId: dlId, status: 'discarded' };
}

// ── Dayparting (agendamento por dia/horário) ────────────────────────────────
// Idempotente: só chama a API quando o status do espelho diverge do desejado.
// NUNCA reativa campanha pausada por outra regra — só reativa o que ELE pausou
// (marcação persistida 'sched:<ruleId>:<campId>').
function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map((v) => parseInt(v, 10) || 0);
  return h * 60 + m;
}

// Devolve { dayIdx, minutes } no fuso da regra (0=domingo).
function localNow(timezone, date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone || 'Europe/Lisbon', hour12: false,
      weekday: 'short', hour: '2-digit', minute: '2-digit',
    }).formatToParts(date);
    const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
    const dayIdx = WEEKDAYS.indexOf(get('weekday').toLowerCase().slice(0, 3));
    // hour pode vir "24" em algumas ICU para meia-noite — normaliza
    const hour = parseInt(get('hour'), 10) % 24;
    const minute = parseInt(get('minute'), 10) || 0;
    return { dayIdx: dayIdx >= 0 ? dayIdx : date.getUTCDay(), minutes: hour * 60 + minute };
  } catch (_) {
    return { dayIdx: date.getUTCDay(), minutes: date.getUTCHours() * 60 + date.getUTCMinutes() };
  }
}

// Uma regra schedule está "dentro da janela" agora? Trata janela cruzando
// meia-noite (22:00–02:00): das 00:00 às end conta como o dia ANTERIOR.
function scheduleActiveNow(rule, date = new Date()) {
  const { dayIdx, minutes } = localNow(rule.timezone, date);
  const start = minutesOf(rule.startTime);
  const end = minutesOf(rule.endTime);
  const days = rule.days || [];
  if (start === end) return days.includes(dayIdx); // janela de 24h no dia
  if (start < end) return days.includes(dayIdx) && minutes >= start && minutes < end;
  // cruza meia-noite: [start→24h) pertence ao dia atual; [0→end) ao dia anterior
  if (minutes >= start) return days.includes(dayIdx);
  if (minutes < end) return days.includes((dayIdx + 6) % 7);
  return false;
}

async function runScheduleSweep(accId, { force, advertiserId: advertiserHint } = {}) {
  if (!provider.enabled) return { executed: [], skipped: true };
  const advertiserId = cleanAdvertiserId(advertiserHint) || await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };
  const schedules = getRules(accId, advertiserId).filter((r) => r.enabled && r.metric === 'schedule');
  if (!schedules.length) return { executed: [], skipped: true };

  // GUARDA 1 — kill switch primeiro, antes até do dry-run: dayparting também
  // é ação do motor e deve parar por completo com o kill switch ativo.
  const policy = await adsOps.getSafetyPolicy(accId);
  if (policy.killSwitch) {
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Kill switch ATIVO: agendamento (dayparting) abortado (zero ações)' });
    return { executed: [], killSwitch: true };
  }
  const dryRun = !!policy.dryRun;
  const to = new Date();
  const { stale, campaigns } = await treeForSweep(accId, advertiserId, {
    fromDate: isoDay(new Date(to.getTime() - 864e5)), toDate: isoDay(to), force,
  });
  if (stale) return { executed: [], stale: true };
  await ensureLoaded(accId);

  // Mesmos guardas do motor de regras: cap de ações/hora (durável, anti-loop)
  // e circuit breaker. Aqui é onde o loop "regra pausa → agendamento reativa"
  // seria pego se as duas frentes ficassem gangorrando.
  let actionsThisHour = policy.maxActionsPerHour > 0 ? await adsOps.countRecentEngineActions(accId, 3600e3, advertiserId) : 0;

  const executed = [];
  let stop = false;
  for (const r of schedules) {
    if (stop) break;
    const shouldRun = scheduleActiveNow(r);
    for (const c of campaigns) {
      if (stop) break;
      const cid = String(c.platformCampaignId || '');
      const name = c.campaignName || cid;
      const markKey = scopedStateKey(advertiserId, 'sched:' + r.id + ':' + cid);
      const pausedByUs = !!getMem(accId, markKey);

      const wantsAction = (!shouldRun && c.status === 'active') || (shouldRun && c.status === 'paused' && pausedByUs);
      const proposedAction = !shouldRun ? 'pause' : 'activate';
      const detail = (shouldRun ? 'dentro' : 'fora') + ' da janela ' + r.startTime + '–' + r.endTime;

      // Agendamento também honra o modo global. Antes, mode=proposal era
      // ignorado aqui e o dayparting executava mesmo quando a interface dizia
      // “eu aprovo”. A proposta leva a marca de autoria; ela só é gravada ou
      // limpa DEPOIS da aprovação executar com sucesso.
      if (wantsAction && !dryRun && r.mode !== 'execute') {
        const states = computeActionStates(proposedAction, c, null);
        const created = await adsOps.createRuleProposal(accId, {
          ruleId: r.id, metric: 'schedule', action: proposedAction, advertiserId,
          campaignId: cid, campaignName: name, detail,
          plan: { ...states, scheduleMarkKey: markKey, scheduleTransition: proposedAction },
        });
        executed.push({
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: proposedAction,
          campaignId: cid, campaignName: name, detail, ok: true, proposed: true,
          result: created ? 'proposta criada — aguardando aprovação' : 'proposta já pendente para esta campanha',
          ...(created ? { proposalId: created.id } : {}),
        });
        if (created) {
          sendPushcut('Aprovada', {
            title: 'Agendamento aguardando você',
            text: 'Sugestão: ' + (proposedAction === 'pause' ? 'pausar' : 'ativar') + ' "' + name + '". Revise no painel.',
            sound: 'system',
          }, accId, {
            event: 'ads_proposal', priority: 'normal', dedupeKey: 'ads:proposal:' + created.id,
          }).catch(() => {});
          await auditReal(accId, {
            action: 'rule_proposal.created', targetType: 'campaign', targetId: cid, advertiserId,
            reason: 'Agendamento: ' + detail,
            metadata: { proposalId: created.id, ruleId: r.id, metric: 'schedule', action: proposedAction },
          });
        }
        continue;
      }
      if (wantsAction && !dryRun) {
        if (breakerOpen(accId, policy, advertiserId)) {
          stop = true;
          stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Circuit breaker ABERTO: agendamento interrompido nesta varredura' });
          sendPushcut('Aprovada', { title: 'Agendamento pausado por segurança', text: 'Muitas ações falharam em sequência. O motor parou para proteger a conta.', sound: 'system' }, accId, { event: 'ads_breaker', priority: 'critical', dedupeKey: 'ads:breaker:' + advertiserId }).catch(() => {});
          break;
        }
        if (policy.maxActionsPerHour > 0 && actionsThisHour >= policy.maxActionsPerHour) {
          stop = true;
          stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido: agendamento parado (anti-loop)' });
          sendPushcut('Aprovada', { title: 'Limite da automação atingido', text: 'O agendamento parou após ' + policy.maxActionsPerHour + ' ações nesta hora.', sound: 'system' }, accId, { event: 'ads_cap', priority: 'critical', dedupeKey: 'ads:cap:' + advertiserId }).catch(() => {});
          break;
        }
      }

      if (!shouldRun && c.status === 'active') {
        // fora da janela: pausa e marca a autoria
        const entry = {
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: 'pause',
          campaignId: cid, campaignName: name, detail, ok: false, simulated: dryRun,
        };
        const beforeState = { kind: 'status', level: 'campaign', id: cid, value: 'active' };
        const afterState = { kind: 'status', level: 'campaign', id: cid, value: 'paused' };
        try {
          if (!dryRun) {
            await setCampaignStatusByKind(c, advertiserId, cid, 'paused');
            await markFired(accId, markKey, 'sched', { ruleId: r.id, pausedAt: new Date().toISOString() });
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'pausada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
        if (!dryRun) recordOutcome(accId, entry.ok, advertiserId);
        if (entry.ok && !dryRun) {
          actionsThisHour += 1;
          const ev = await auditReal(accId, {
            action: 'schedule_action', targetType: 'campaign', targetId: cid, advertiserId,
            beforeState, afterState, reason: 'Agendamento: ' + entry.detail,
            metadata: { ruleId: r.id, action: 'pause' },
          });
          if (ev && ev.id) entry.auditId = ev.id;
        } else if (entry.ok && dryRun) {
          await auditSimulated(accId, {
            action: 'schedule_action', targetType: 'campaign', targetId: cid, advertiserId,
            metadata: { ruleId: r.id, action: 'pause', beforeState, afterState }, title: 'Agendamento: ' + entry.result,
          });
        }
        executed.push(entry);
      } else if (shouldRun && c.status === 'paused' && pausedByUs) {
        // dentro da janela: SÓ reativa o que o agendamento pausou
        const entry = {
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: 'activate',
          campaignId: cid, campaignName: name, detail, ok: false, simulated: dryRun,
        };
        const beforeState = { kind: 'status', level: 'campaign', id: cid, value: 'paused' };
        const afterState = { kind: 'status', level: 'campaign', id: cid, value: 'active' };
        try {
          if (!dryRun) {
            await setCampaignStatusByKind(c, advertiserId, cid, 'active');
            await clearFired(accId, markKey);
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'reativada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
        if (!dryRun) recordOutcome(accId, entry.ok, advertiserId);
        if (entry.ok && !dryRun) {
          actionsThisHour += 1;
          const ev = await auditReal(accId, {
            action: 'schedule_action', targetType: 'campaign', targetId: cid, advertiserId,
            beforeState, afterState, reason: 'Agendamento: ' + entry.detail,
            metadata: { ruleId: r.id, action: 'activate' },
          });
          if (ev && ev.id) entry.auditId = ev.id;
        } else if (entry.ok && dryRun) {
          await auditSimulated(accId, {
            action: 'schedule_action', targetType: 'campaign', targetId: cid, advertiserId,
            metadata: { ruleId: r.id, action: 'activate', beforeState, afterState }, title: 'Agendamento: ' + entry.result,
          });
        }
        executed.push(entry);
      }
    }
  }
  if (executed.some((e) => e.ok && !e.simulated && !e.proposed)) syncAfterWrite(accId, advertiserId);
  if (executed.length) {
    appendRulesLog(accId, executed, advertiserId);
    for (const e of executed.filter((x) => x.ok)) {
      stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Agendamento: ' + e.result + ' — "' + e.campaignName + '"' });
    }
  }
  return { executed, checkedAt: new Date().toISOString() };
}

// ── Orquestração com throttle único ─────────────────────────────────────────
// Chamada pelo hook das rotas E pelo tick do ads-sync — o throttle vive AQUI,
// então não importa quantos gatilhos disparem: uma varredura por janela.
const sweepLast = new Map();    // account+advertiser → ts (regras+alertas)
const scheduleLast = new Map(); // account+advertiser → ts (dayparting)

function sweepKey(accId, advertiserId) { return String(accId) + ':' + cleanAdvertiserId(advertiserId); }

function maybeSweep(accId, advertiserHint) {
  try {
    if (!accId) return;
    const advertiserId = cleanAdvertiserId(advertiserHint || provider.getState(accId).advertiserId);
    if (!advertiserId) return;
    const key = sweepKey(accId, advertiserId);
    const now = Date.now();
    if (now - (sweepLast.get(key) || 0) > SWEEP_THROTTLE_MS) {
      const hasAlerts = getAlertCfg(accId, advertiserId).enabled;
      const hasRules = getRules(accId, advertiserId).some((r) => r.enabled && r.metric !== 'schedule');
      if (hasAlerts || hasRules) {
        sweepLast.set(key, now);
        if (hasAlerts) runAlertSweep(accId, { advertiserId }).catch(() => {});
        if (hasRules) runRulesSweep(accId, { advertiserId }).catch(() => {});
      }
    }
    if (now - (scheduleLast.get(key) || 0) > SCHEDULE_THROTTLE_MS) {
      if (getRules(accId, advertiserId).some((r) => r.enabled && r.metric === 'schedule')) {
        scheduleLast.set(key, now);
        runScheduleSweep(accId, { advertiserId }).catch(() => {});
      }
    }
  } catch (_) { /* nunca derruba o chamador */ }
}

// Marca "varredura feita agora" (rotas manuais /rules/run e /alerts/check).
function markSweepNow(accId, advertiserId) { sweepLast.set(sweepKey(accId, advertiserId), Date.now()); }

// Resumo p/ o painel de diagnóstico MCP: última varredura, regras ativas e
// último disparo do log — a UI mostra que o motor 24/7 está de fato girando.
function getSweepInfo(accId, advertiserId) {
  const id = profileId(accId, advertiserId);
  const key = sweepKey(accId, id);
  const profile = getAutomationProfile(accId, id);
  const rules = profile.rules;
  const log = profile.rulesLog;
  const enabled = rules.filter((r) => r.enabled).length;
  const lastSweepMs = sweepLast.get(key) || 0;
  const lastScheduleMs = scheduleLast.get(key) || 0;
  const nextRulesMs = lastSweepMs ? lastSweepMs + SWEEP_THROTTLE_MS : 0;
  const nextScheduleMs = lastScheduleMs ? lastScheduleMs + SCHEDULE_THROTTLE_MS : 0;
  const nextMs = [nextRulesMs, nextScheduleMs].filter(Boolean).sort((a, b) => a - b)[0] || 0;
  return {
    advertiserId: id,
    revision: profile.revision,
    autonomy: profile.autonomy,
    updatedAt: profile.updatedAt,
    status: enabled || profile.alerts.enabled ? 'active' : 'idle',
    lastSweepAt: lastSweepMs ? new Date(lastSweepMs).toISOString() : null,
    lastScheduleSweepAt: lastScheduleMs ? new Date(lastScheduleMs).toISOString() : null,
    nextSweepAt: nextMs ? new Date(nextMs).toISOString() : null,
    rulesEnabled: rules.filter((r) => r.enabled && r.metric !== 'schedule').length,
    schedulesEnabled: rules.filter((r) => r.enabled && r.metric === 'schedule').length,
    alertsEnabled: !!profile.alerts.enabled,
    lastAction: log.length ? { at: log[0].at, result: log[0].result || log[0].detail, campaignName: log[0].campaignName, ok: !!log[0].ok } : null,
  };
}

function getAutomationSnapshot(accId, advertiserId) {
  const profile = getAutomationProfile(accId, advertiserId);
  return {
    advertiserId: profile.advertiserId,
    revision: profile.revision,
    autonomy: profile.autonomy,
    updatedAt: profile.updatedAt,
    rules: [...profile.rules],
    log: [...profile.rulesLog],
    alerts: { ...profile.alerts },
    engine: getSweepInfo(accId, profile.advertiserId),
  };
}

// ── Auto-recuperação de conta bloqueada ─────────────────────────────────────
// Chamado pelo ads-sync quando um sync de conta antes 'blocked' dá certo.
function noteRecovery(accId, advertiserId) {
  stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Conta ' + advertiserId + ' recuperada automaticamente (bloqueio da Pipeboard resolvido)' });
  appendRulesLog(accId, [{
    at: new Date().toISOString(), ruleId: 'system', metric: 'recovery', action: 'unblock',
    campaignId: advertiserId, campaignName: 'Conta ' + advertiserId,
    detail: 'sync voltou a funcionar após bloqueio', ok: true, result: 'conta recuperada automaticamente',
  }], advertiserId);
}

module.exports = {
  init,
  RULE_METRICS,
  RULE_ACTIONS,
  ALERT_DEFAULTS,
  ALERT_PRESET,
  AUTOMATION_AUTONOMY,
  AUTOMATION_PROFILE_LIMIT,
  buildRulePresets,
  getAutomationProfile,
  getAutomationSnapshot,
  getAlertCfg,
  getRules,
  getRulesLog,
  appendRulesLog,
  saveRules,
  saveAlerts,
  setGlobalAutonomy,
  validateRules,
  computeAttribution,
  runAlertSweep,
  runRulesSweep,
  runScheduleSweep,
  backtestRules,
  approveProposal,
  reprocessDeadLetter,
  discardDeadLetter,
  maybeSweep,
  markSweepNow,
  getSweepInfo,
  getBreakerState,
  ensureBreakerHydrated,
  noteRecovery,
  // expostos p/ testes
  _internals: { scheduleActiveNow, localNow, minutesOf, underCooldown, markFired, clearFired, memState, treeForSweep, sumAccountDailyBudget, recordOutcome, breakerOpen, getBreakerState, ensureBreakerHydrated, actionOutcomes, breakerLastAt, breakerHydrated, evaluateRule, metricsContext, computeBudgetPlan, executeRuleAction, computeActionStates, setCampaignStatusByKind, autoAppealRejectedSmartPlus, APPEAL_COOLDOWN_MS, APPEAL_RETRY_MS },
};
