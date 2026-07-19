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
const { sendPushcut } = require('./pushcut');

// ── Configuração ────────────────────────────────────────────────────────────
const SWEEP_THROTTLE_MS = Number(process.env.ADS_RULES_SWEEP_MS) || 30 * 60e3;      // regras+alertas: 30min/conta
const SCHEDULE_THROTTLE_MS = Number(process.env.ADS_SCHEDULE_SWEEP_MS) || 4 * 60e3; // dayparting: ~todo tick
const FRESHNESS_MS = Number(process.env.ADS_SWEEP_FRESHNESS_MS) || 15 * 60e3;       // idade máx. do espelho p/ agir
const RULE_COOLDOWN_MS = 12 * 3600e3;   // 1 ação por episódio (12h por campanha+regra)
const SCALE_COOLDOWN_MS = 24 * 3600e3;  // roas_scale: no máx. 1 escala/dia por campanha
const ALERT_COOLDOWN_MS = 6 * 3600e3;   // alertas: 6h por campanha+regra

const RULE_METRICS = ['cpa_max', 'spend_no_conv', 'roas_min', 'ctr_min', 'cpm_max', 'cpc_max', 'roas_scale', 'schedule'];
const RULE_ACTIONS = ['pause', 'budget_down', 'budget_up'];
const ALERT_DEFAULTS = { enabled: false, spendNoConv: 20, cpaMax: 0, lookbackDays: 2, rejectedAds: false };
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

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

// ── Config por conta (mesmo storage de antes: estado do provider) ───────────
// Seed automático na PRIMEIRA leitura: se a conta nunca teve config (nem flag,
// nem dados), semeia os presets e marca a flag. Conta que já configurou algo
// (regras/alertas existentes de antes deste deploy) só ganha a flag — os dados
// dela NUNCA são sobrescritos. O PUT das rotas também seta a flag, então
// "salvar lista vazia" é respeitado como escolha (não re-semeia).
function getAlertCfg(accId) {
  const st = provider.getState(accId);
  if (!st.alertsSeeded) {
    const hasOwn = st.alerts && typeof st.alerts === 'object' && Object.keys(st.alerts).length > 0;
    provider.setState(accId, hasOwn ? { alertsSeeded: true } : { alertsSeeded: true, alerts: { ...ALERT_PRESET } });
    if (!hasOwn) return Object.assign({}, ALERT_DEFAULTS, ALERT_PRESET);
  }
  return Object.assign({}, ALERT_DEFAULTS, provider.getState(accId).alerts || {});
}
function getRules(accId) {
  const st = provider.getState(accId);
  if (!st.rulesSeeded) {
    const hasOwn = Array.isArray(st.rules) && st.rules.length > 0;
    if (hasOwn) {
      provider.setState(accId, { rulesSeeded: true });
    } else {
      const seeded = buildRulePresets();
      provider.setState(accId, { rulesSeeded: true, rules: seeded });
      return seeded;
    }
  }
  const cur = provider.getState(accId);
  return Array.isArray(cur.rules) ? cur.rules : [];
}
function getRulesLog(accId) {
  const st = provider.getState(accId);
  return Array.isArray(st.rulesLog) ? st.rulesLog : [];
}
function appendRulesLog(accId, entries) {
  if (!entries.length) return;
  const log = [...entries, ...getRulesLog(accId)].slice(0, 50);
  provider.setState(accId, { rulesLog: log });
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
const actionOutcomes = new Map(); // accId → boolean[] (true = ok)
function recordOutcome(accId, ok) {
  const arr = actionOutcomes.get(accId) || [];
  arr.push(!!ok);
  while (arr.length > 20) arr.shift();
  actionOutcomes.set(accId, arr);
}
function breakerOpen(accId, policy) {
  return adsOps.circuitBreakerOpen(actionOutcomes.get(accId) || [], policy.circuitBreakerErrorPct, 10);
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

// ── Alertas (não agem — só notificam) ───────────────────────────────────────
async function runAlertSweep(accId, { force } = {}) {
  const cfg = getAlertCfg(accId);
  if (!cfg.enabled && !force) return { findings: [], skipped: true };
  if (!provider.enabled) return { findings: [], skipped: true };
  const advertiserId = await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { findings: [], skipped: true };

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
    (rejected || []).forEach((c) => {
      const name = c.campaignName || c.platformCampaignId;
      findings.push({
        rule: 'rejected_ads', campaignId: c.platformCampaignId, campaignName: name,
        text: '"' + name + '" teve anúncio REPROVADO na revisão do TikTok — corrija o criativo ou recorra.'
      });
    });
  }

  for (const f of findings) {
    const key = 'alert:' + f.campaignId + ':' + f.rule;
    if (await underCooldown(accId, key, ALERT_COOLDOWN_MS)) { f.muted = true; continue; }
    await markFired(accId, key, 'alert', { rule: f.rule });
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] ' + f.text });
    sendPushcut('Aprovada', { title: 'TikTok Ads: atenção', text: f.text, sound: 'system' }, accId).catch(() => {});
  }
  return { findings, checkedAt: new Date().toISOString() };
}

// ── Execução de UMA ação de regra (pause / budget ±) ────────────────────────
// F3: extraída do corpo do sweep para o approve de proposta executar pelo
// MESMO caminho (mesmos provider calls, mesmos before/after) — sem reimplementar
// e divergir. Estados são computados de forma pura (proposta usa sem executar).
function computeActionStates(action, campaign, plan) {
  if (action === 'pause') {
    return {
      beforeState: { kind: 'status', level: 'campaign', id: campaign.platformCampaignId, value: campaign.status || 'active' },
      afterState: { kind: 'status', level: 'campaign', id: campaign.platformCampaignId, value: 'paused' },
    };
  }
  const changes = (plan && plan.changes) || [];
  return {
    beforeState: { kind: 'budget', adGroups: changes.map((ch) => ({ id: ch.adGroupId, amount: ch.cur, type: ch.type })) },
    afterState: { kind: 'budget', adGroups: changes.map((ch) => ({ id: ch.adGroupId, amount: ch.amount, type: ch.type })) },
  };
}

async function executeRuleAction({ advertiserId, action, campaign, plan, dryRun }) {
  const { beforeState, afterState } = computeActionStates(action, campaign, plan);
  const prefix = dryRun ? '[simulado] ' : '';
  if (action === 'pause') {
    if (!dryRun) await provider.setCampaignStatus(advertiserId, [campaign.platformCampaignId], 'paused');
    return { ok: true, result: prefix + 'campanha pausada', beforeState, afterState };
  }
  const { pct, cap, capped, changes } = plan;
  let changed = 0;
  for (const ch of changes) {
    if (!dryRun) {
      await provider.updateAdGroup(advertiserId, ch.adGroupId, { budget: { amount: ch.amount, type: ch.type } });
    }
    changed += 1;
  }
  let result = prefix + 'orçamento ' + (action === 'budget_up' ? '+' : '-') + pct + '% em ' + changed + ' grupo(s)'
    + (capped ? ' (teto ' + cap + ' aplicado em ' + capped + ')' : '');
  if (!changed && capped) result = prefix + 'todos os grupos já no teto de ' + cap;
  return { ok: changed > 0, result, beforeState, afterState };
}

// ── Regras (agem: pause / budget ±) ─────────────────────────────────────────
async function runRulesSweep(accId, { force } = {}) {
  const rules = getRules(accId).filter((r) => r.enabled && r.metric !== 'schedule');
  if (!rules.length) return { executed: [], skipped: true };
  if (!provider.enabled) return { executed: [], skipped: true };

  // GUARDA 1 — a PRIMEIRA de todas, antes até do dry-run: kill switch.
  // Com ele ativo o motor não avalia nem age em NADA.
  const policy = await adsOps.getSafetyPolicy(accId);
  if (policy.killSwitch) {
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Kill switch ATIVO: varredura de regras abortada (zero ações)' });
    return { executed: [], killSwitch: true };
  }
  const advertiserId = await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };

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
  let actionsThisHour = policy.maxActionsPerHour > 0 ? await adsOps.countRecentEngineActions(accId, 3600e3) : 0;
  // Orçamento diário corrente da conta (base do teto de gasto). Cresce conforme
  // aplicamos budget_up de verdade, para o teto valer dentro do próprio sweep.
  let accountDailyBudget = sumAccountDailyBudget(campaigns);

  const executed = [];
  let stop = false; // cap/breaker atingido → para de agir no resto do sweep
  for (const c of campaigns) {
    if (stop) break;
    const m = c.metrics || {};
    const spend = Number(m.spend) || 0;
    const conv = Number(m.conversions) || 0;
    const impressions = Number(m.impressions) || 0;
    const clicks = Number(m.clicks) || 0;
    const ctrPct = impressions > 0 ? (clicks / impressions) * 100 : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const name = c.campaignName || c.platformCampaignId;
    const attr = attribution.byCampaign[c.platformCampaignId] || { revenueCents: 0, sales: 0 };
    const roas = spend > 0 ? (attr.revenueCents / 100) / spend : null;

    for (const r of rules) {
      if (stop) break;
      // GUARDA — circuit breaker: muitas falhas reais seguidas → para de tentar.
      if (!dryRun && breakerOpen(accId, policy)) {
        stop = true;
        stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Circuit breaker ABERTO (≥' + policy.circuitBreakerErrorPct + '% de falhas): motor interrompido nesta varredura' });
        sendPushcut('Aprovada', { title: 'TikTok Ads: circuit breaker', text: 'Muitas falhas seguidas nas ações automáticas — motor pausado até a próxima varredura.', sound: 'system' }, accId).catch(() => {});
        break;
      }
      // GUARDA — cap de ações/hora (anti-loop: pausa→reativa→repete). Só conta
      // ações reais; dry-run nunca trava.
      if (!dryRun && policy.maxActionsPerHour > 0 && actionsThisHour >= policy.maxActionsPerHour) {
        stop = true;
        stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido: motor parado (anti-loop)' });
        sendPushcut('Aprovada', { title: 'TikTok Ads: limite de ações/hora', text: 'Atingido o teto de ' + policy.maxActionsPerHour + ' ações automáticas por hora. O motor parou para evitar loop.', sound: 'system' }, accId).catch(() => {});
        break;
      }

      let hit = false; let detail = '';
      if (r.metric === 'cpa_max' && r.threshold > 0 && conv > 0 && spend / conv > r.threshold
        && impressions >= (r.minImpressions || 1000) && clicks >= (r.minClicks || 30)) {
        hit = true; detail = 'CPA ' + (spend / conv).toFixed(2) + ' > teto ' + r.threshold + ' (' + clicks + ' cliques, ' + impressions + ' impr.)';
      } else if (r.metric === 'spend_no_conv' && r.threshold > 0 && conv === 0 && spend >= r.threshold
        && impressions >= (r.minImpressions || 1000) && clicks >= (r.minClicks || 30)) {
        hit = true; detail = 'gastou ' + spend.toFixed(2) + ' sem conversão (' + clicks + ' cliques, ' + impressions + ' impr.)';
      } else if (r.metric === 'roas_min' && r.threshold > 0 && spend > 0 && roas !== null && roas < r.threshold) {
        // guarda: sem vendas atribuíveis, ROAS "0" pode ser só atraso de webhook.
        // roas_min exige pelo menos 1 venda atribuída na conta no período OU
        // gasto expressivo (≥ 3× o piso em unidades monetárias) p/ agir.
        const anySales = Object.values(attribution.byCampaign).some((a) => a.sales > 0);
        if (anySales || attr.sales > 0) { hit = true; detail = 'ROAS ' + roas.toFixed(2) + ' < piso ' + r.threshold; }
      } else if (r.metric === 'ctr_min' && r.threshold > 0 && ctrPct !== null
        && impressions >= (r.minImpressions || 1000) && ctrPct < r.threshold) {
        hit = true; detail = 'CTR ' + ctrPct.toFixed(2) + '% < mínimo ' + r.threshold + '% (' + impressions + ' impressões)';
      } else if (r.metric === 'cpm_max' && r.threshold > 0 && cpm !== null
        && spend >= (r.minSpend || 1) && cpm > r.threshold) {
        hit = true; detail = 'CPM ' + cpm.toFixed(2) + ' > teto ' + r.threshold;
      } else if (r.metric === 'cpc_max' && r.threshold > 0 && clicks >= (r.minClicks || 30)
        && spend / clicks > r.threshold) {
        hit = true; detail = 'CPC ' + (spend / clicks).toFixed(2) + ' > teto ' + r.threshold + ' (' + clicks + ' cliques)';
      } else if (r.metric === 'roas_scale' && r.threshold > 0 && roas !== null
        && attr.sales >= (r.minSales || 2) && roas >= r.threshold) {
        hit = true; detail = 'ROAS ' + roas.toFixed(2) + ' ≥ ' + r.threshold + ' com ' + attr.sales + ' venda(s) — escalando';
      }
      if (!hit) continue;

      // Pré-computa alterações de orçamento ANTES de consumir cooldown: uma
      // recusa por teto de gasto não deve "gastar" o cooldown de 12h da regra.
      let plan = null;
      if (r.action !== 'pause') {
        const pctRaw = Math.max(5, Math.min(50, Number(r.pct) || 20));
        // GUARDA — maxBudgetChangePct da política vale para o MOTOR também
        // (antes só valia em bulk/jobs via assertMutationAllowed).
        const pct = Math.min(pctRaw, policy.maxBudgetChangePct);
        const factor = r.action === 'budget_up' ? 1 + pct / 100 : 1 - pct / 100;
        const cap = r.metric === 'roas_scale' ? Number(r.budgetCap) || 0 : 0;
        const changes = []; let capped = 0; let delta = 0;
        for (const s of (c.adSets || []).slice(0, 10)) {
          const cur = Number((s.budget || {}).amount) || 0;
          const adGroupId = s.platformAdSetId || s._id;
          if (!(cur > 0) || !adGroupId) continue;
          let amount = Math.max(1, +(cur * factor).toFixed(2));
          if (cap > 0 && amount > cap) {
            if (cur >= cap) { capped += 1; continue; } // já no teto: não toca
            amount = cap; capped += 1;
          }
          const type = (s.budget || {}).type === 'lifetime' ? 'lifetime' : 'daily';
          changes.push({ adGroupId, cur, amount, type });
          if (type !== 'lifetime') delta += amount - cur;
        }
        plan = { pct, cap, capped, changes, delta };
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
      const key = 'rule:' + c.platformCampaignId + ':' + r.id;
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
          sendPushcut('Aprovada', { title: 'TikTok Ads: proposta aguardando', text: 'Regra sugere: ' + (r.action === 'pause' ? 'pausar' : 'ajustar orçamento de') + ' "' + name + '" (' + detail + '). Aprove no painel.', sound: 'system' }, accId).catch(() => {});
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
      }
      if (!dryRun) recordOutcome(accId, entry.ok);       // alimenta o circuit breaker
      if (entry.ok && !dryRun) actionsThisHour += 1;      // conta p/ o cap/hora
      executed.push(entry);
      stats.logEvent(entry.ok ? 'info' : 'warn', { acc: accId, title: '[tiktok-ads] Regra ' + (entry.ok ? 'executada' : 'FALHOU') + ': ' + entry.result + ' — "' + name + '" (' + detail + ')' });
      sendPushcut('Aprovada', { title: 'TikTok Ads: regra automática', text: entry.result + ' — "' + name + '" (' + detail + ')', sound: 'system' }, accId).catch(() => {});
    }
  }
  // Propostas não mudaram nada na plataforma — não disparam sync pós-escrita.
  if (executed.some((e) => e.ok && !e.simulated && !e.proposed)) syncAfterWrite(accId, advertiserId);
  appendRulesLog(accId, executed);
  return { executed, checkedAt: new Date().toISOString() };
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
  const policy = await adsOps.getSafetyPolicy(accId);
  adsOps.assertMutationAllowed(policy, { advertiserId: p.advertiser_id, idempotencyKey: 'proposal:' + p.id });
  if (policy.dryRun) { const e = new Error('Modo simulação (dry-run) ativo na política — desative para executar aprovações'); e.status = 409; throw e; }
  if (breakerOpen(accId, policy)) { const e = new Error('Circuit breaker aberto (muitas falhas recentes) — tente mais tarde'); e.status = 409; throw e; }
  if (policy.maxActionsPerHour > 0) {
    const n = await adsOps.countRecentEngineActions(accId, 3600e3);
    if (n >= policy.maxActionsPerHour) { const e = new Error('Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido — tente mais tarde'); e.status = 429; throw e; }
  }

  // Transição ATÔMICA pending→approved (carrega o TTL de 6h no WHERE): dois
  // cliques concorrentes → só um executa; proposta velha → recusada aqui.
  const approved = await adsOps.decideRuleProposal(accId, proposalId, 'approved');
  if (!approved) { const e = new Error('Proposta expirada ou já decidida'); e.status = 409; throw e; }

  const plan = approved.plan || {};
  const advertiserId = approved.advertiser_id || await provider.resolveAdvertiserId(accId);
  const failReval = async (msg) => {
    await adsOps.markProposalExecution(accId, approved.id, false, msg);
    const e = new Error(msg); e.status = 409; throw e;
  };

  // RE-VALIDAÇÃO contra o espelho atual (cai para a API viva se o espelho
  // estiver velho — aprovação é rara e exatidão importa mais que 1 request).
  const to = new Date();
  const range = { fromDate: isoDay(new Date(to.getTime() - 2 * 864e5)), toDate: isoDay(to), status: 'active' };
  let t = await treeForSweep(accId, advertiserId, range);
  if (t.stale) t = await treeForSweep(accId, advertiserId, { ...range, force: true });
  const c = (t.campaigns || []).find((x) => String(x.platformCampaignId) === String(approved.campaign_id));
  if (!c) await failReval('Campanha já não está ativa — a proposta não se aplica mais');
  if (approved.action !== 'pause') {
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
    recordOutcome(accId, done.ok); // alimenta o circuit breaker como qualquer ação real
    const ev = await auditReal(accId, {
      action: 'rule_proposal.approved', targetType: 'campaign', targetId: approved.campaign_id, advertiserId,
      beforeState: done.beforeState, afterState: done.afterState,
      reason: 'Proposta aprovada: ' + (approved.detail || ''),
      metadata: { proposalId: approved.id, ruleId: approved.rule_id, metric: approved.metric, action: approved.action },
    });
    if (ev && ev.id) entry.auditId = ev.id;
    await adsOps.markProposalExecution(accId, approved.id, done.ok, done.ok ? null : done.result);
    if (done.ok) syncAfterWrite(accId, advertiserId);
    appendRulesLog(accId, [entry]);
    stats.logEvent(done.ok ? 'info' : 'warn', { acc: accId, title: '[tiktok-ads] Proposta ' + (done.ok ? 'executada' : 'FALHOU') + ': ' + entry.result + ' — "' + entry.campaignName + '"' });
    return { ok: done.ok, result: entry.result, proposalId: approved.id, auditId: entry.auditId || null };
  } catch (err) {
    const msg = 'falhou: ' + String(err && err.message ? err.message : 'erro').slice(0, 200);
    recordOutcome(accId, false);
    await adsOps.markProposalExecution(accId, approved.id, false, msg);
    entry.result = msg;
    appendRulesLog(accId, [entry]);
    const e = new Error(msg); e.status = 502; throw e;
  }
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

async function runScheduleSweep(accId, { force } = {}) {
  const schedules = getRules(accId).filter((r) => r.enabled && r.metric === 'schedule');
  if (!schedules.length) return { executed: [], skipped: true };
  if (!provider.enabled) return { executed: [], skipped: true };

  // GUARDA 1 — kill switch primeiro, antes até do dry-run: dayparting também
  // é ação do motor e deve parar por completo com o kill switch ativo.
  const policy = await adsOps.getSafetyPolicy(accId);
  if (policy.killSwitch) {
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Kill switch ATIVO: agendamento (dayparting) abortado (zero ações)' });
    return { executed: [], killSwitch: true };
  }
  const advertiserId = await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };

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
  let actionsThisHour = policy.maxActionsPerHour > 0 ? await adsOps.countRecentEngineActions(accId, 3600e3) : 0;

  const executed = [];
  let stop = false;
  for (const r of schedules) {
    if (stop) break;
    const shouldRun = scheduleActiveNow(r);
    for (const c of campaigns) {
      if (stop) break;
      const cid = String(c.platformCampaignId || '');
      const name = c.campaignName || cid;
      const markKey = 'sched:' + r.id + ':' + cid;
      const pausedByUs = !!getMem(accId, markKey);

      const wantsAction = (!shouldRun && c.status === 'active') || (shouldRun && c.status === 'paused' && pausedByUs);
      if (wantsAction && !dryRun) {
        if (breakerOpen(accId, policy)) {
          stop = true;
          stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Circuit breaker ABERTO: agendamento interrompido nesta varredura' });
          sendPushcut('Aprovada', { title: 'TikTok Ads: circuit breaker', text: 'Muitas falhas seguidas — agendamento pausado até a próxima varredura.', sound: 'system' }, accId).catch(() => {});
          break;
        }
        if (policy.maxActionsPerHour > 0 && actionsThisHour >= policy.maxActionsPerHour) {
          stop = true;
          stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] Cap de ' + policy.maxActionsPerHour + ' ações/hora atingido: agendamento parado (anti-loop)' });
          sendPushcut('Aprovada', { title: 'TikTok Ads: limite de ações/hora', text: 'Teto de ' + policy.maxActionsPerHour + ' ações/hora atingido — agendamento parado para evitar loop.', sound: 'system' }, accId).catch(() => {});
          break;
        }
      }

      if (!shouldRun && c.status === 'active') {
        // fora da janela: pausa e marca a autoria
        const entry = {
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: 'pause',
          campaignId: cid, campaignName: name, detail: 'fora da janela ' + r.startTime + '–' + r.endTime, ok: false, simulated: dryRun,
        };
        const beforeState = { kind: 'status', level: 'campaign', id: cid, value: 'active' };
        const afterState = { kind: 'status', level: 'campaign', id: cid, value: 'paused' };
        try {
          if (!dryRun) {
            await provider.setCampaignStatus(advertiserId, [cid], 'paused');
            await markFired(accId, markKey, 'sched', { ruleId: r.id, pausedAt: new Date().toISOString() });
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'pausada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
        if (!dryRun) recordOutcome(accId, entry.ok);
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
          campaignId: cid, campaignName: name, detail: 'dentro da janela ' + r.startTime + '–' + r.endTime, ok: false, simulated: dryRun,
        };
        const beforeState = { kind: 'status', level: 'campaign', id: cid, value: 'paused' };
        const afterState = { kind: 'status', level: 'campaign', id: cid, value: 'active' };
        try {
          if (!dryRun) {
            await provider.setCampaignStatus(advertiserId, [cid], 'active');
            await clearFired(accId, markKey);
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'reativada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
        if (!dryRun) recordOutcome(accId, entry.ok);
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
  if (executed.some((e) => e.ok && !e.simulated)) syncAfterWrite(accId, advertiserId);
  if (executed.length) {
    appendRulesLog(accId, executed);
    for (const e of executed.filter((x) => x.ok)) {
      stats.logEvent('info', { acc: accId, title: '[tiktok-ads] Agendamento: ' + e.result + ' — "' + e.campaignName + '"' });
    }
  }
  return { executed, checkedAt: new Date().toISOString() };
}

// ── Orquestração com throttle único ─────────────────────────────────────────
// Chamada pelo hook das rotas E pelo tick do ads-sync — o throttle vive AQUI,
// então não importa quantos gatilhos disparem: uma varredura por janela.
const sweepLast = new Map();    // accId → ts (regras+alertas)
const scheduleLast = new Map(); // accId → ts (dayparting)

function maybeSweep(accId) {
  try {
    if (!accId) return;
    const now = Date.now();
    if (now - (sweepLast.get(accId) || 0) > SWEEP_THROTTLE_MS) {
      const hasAlerts = getAlertCfg(accId).enabled;
      const hasRules = getRules(accId).some((r) => r.enabled && r.metric !== 'schedule');
      if (hasAlerts || hasRules) {
        sweepLast.set(accId, now);
        if (hasAlerts) runAlertSweep(accId).catch(() => {});
        if (hasRules) runRulesSweep(accId).catch(() => {});
      }
    }
    if (now - (scheduleLast.get(accId) || 0) > SCHEDULE_THROTTLE_MS) {
      if (getRules(accId).some((r) => r.enabled && r.metric === 'schedule')) {
        scheduleLast.set(accId, now);
        runScheduleSweep(accId).catch(() => {});
      }
    }
  } catch (_) { /* nunca derruba o chamador */ }
}

// Marca "varredura feita agora" (rotas manuais /rules/run e /alerts/check).
function markSweepNow(accId) { sweepLast.set(accId, Date.now()); }

// Resumo p/ o painel de diagnóstico MCP: última varredura, regras ativas e
// último disparo do log — a UI mostra que o motor 24/7 está de fato girando.
function getSweepInfo(accId) {
  const rules = getRules(accId);
  const log = getRulesLog(accId);
  return {
    lastSweepAt: sweepLast.has(accId) ? new Date(sweepLast.get(accId)).toISOString() : null,
    lastScheduleSweepAt: scheduleLast.has(accId) ? new Date(scheduleLast.get(accId)).toISOString() : null,
    rulesEnabled: rules.filter((r) => r.enabled && r.metric !== 'schedule').length,
    schedulesEnabled: rules.filter((r) => r.enabled && r.metric === 'schedule').length,
    alertsEnabled: !!getAlertCfg(accId).enabled,
    lastAction: log.length ? { at: log[0].at, result: log[0].result || log[0].detail, campaignName: log[0].campaignName, ok: !!log[0].ok } : null,
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
  }]);
}

module.exports = {
  init,
  RULE_METRICS,
  RULE_ACTIONS,
  ALERT_DEFAULTS,
  ALERT_PRESET,
  buildRulePresets,
  getAlertCfg,
  getRules,
  getRulesLog,
  appendRulesLog,
  validateRules,
  computeAttribution,
  runAlertSweep,
  runRulesSweep,
  runScheduleSweep,
  approveProposal,
  maybeSweep,
  markSweepNow,
  getSweepInfo,
  noteRecovery,
  // expostos p/ testes
  _internals: { scheduleActiveNow, localNow, minutesOf, underCooldown, markFired, clearFired, memState, treeForSweep, sumAccountDailyBudget, recordOutcome, breakerOpen, actionOutcomes, executeRuleAction, computeActionStates },
};
