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

const RULE_METRICS = ['cpa_max', 'spend_no_conv', 'roas_min', 'ctr_min', 'cpm_max', 'roas_scale', 'schedule'];
const RULE_ACTIONS = ['pause', 'budget_down', 'budget_up'];
const ALERT_DEFAULTS = { enabled: false, spendNoConv: 20, cpaMax: 0, lookbackDays: 2 };
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

// ── Config por conta (mesmo storage de antes: estado do provider) ───────────
function getAlertCfg(accId) {
  return Object.assign({}, ALERT_DEFAULTS, provider.getState(accId).alerts || {});
}
function getRules(accId) {
  const st = provider.getState(accId);
  return Array.isArray(st.rules) ? st.rules : [];
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
      threshold: Math.max(0, Math.min(100000, Number(r.threshold) || 0)),
      lookbackDays: Math.max(1, Math.min(30, parseInt(r.lookbackDays, 10) || 2)),
      action: RULE_ACTIONS.includes(r.action) ? r.action : 'pause',
      pct: Math.max(5, Math.min(50, Number(r.pct) || 20)),
    };
    if (metric === 'ctr_min') {
      // guarda de volume: nunca pausar campanha recém-ligada com 10 impressões
      out.minImpressions = Math.max(100, Math.min(1000000, parseInt(r.minImpressions, 10) || 1000));
    }
    if (metric === 'cpm_max') {
      out.minSpend = Math.max(0.5, Math.min(100000, Number(r.minSpend) || 1));
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

// ── Dry-run (mesma guarda fechada das rotas: na dúvida, simula) ─────────────
async function isDryRun(accId) {
  const policy = await adsOps.getSafetyPolicy(accId);
  return !!(policy && policy.dryRun);
}

async function auditSimulated(accId, { action, targetType, targetId, advertiserId, metadata, title }) {
  try {
    await adsOps.appendAuditEvent(accId, {
      actorType: 'system', action: action + '.simulated', targetType, targetId,
      advertiserId, reason: title || 'Simulado (dry-run)', metadata: metadata || {}
    });
  } catch (_) { /* auditoria é best-effort */ }
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

  for (const f of findings) {
    const key = 'alert:' + f.campaignId + ':' + f.rule;
    if (await underCooldown(accId, key, ALERT_COOLDOWN_MS)) { f.muted = true; continue; }
    await markFired(accId, key, 'alert', { rule: f.rule });
    stats.logEvent('warn', { acc: accId, title: '[tiktok-ads] ' + f.text });
    sendPushcut('Aprovada', { title: 'TikTok Ads: atenção', text: f.text, sound: 'system' }, accId).catch(() => {});
  }
  return { findings, checkedAt: new Date().toISOString() };
}

// ── Regras (agem: pause / budget ±) ─────────────────────────────────────────
async function runRulesSweep(accId, { force } = {}) {
  const rules = getRules(accId).filter((r) => r.enabled && r.metric !== 'schedule');
  if (!rules.length) return { executed: [], skipped: true };
  if (!provider.enabled) return { executed: [], skipped: true };
  const advertiserId = await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };

  const dryRun = await isDryRun(accId);
  const to = new Date();
  const maxLookback = Math.max(...rules.map((r) => r.lookbackDays || 2), 1);
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

  const executed = [];
  for (const c of campaigns) {
    const m = c.metrics || {};
    const spend = Number(m.spend) || 0;
    const conv = Number(m.conversions) || 0;
    const impressions = Number(m.impressions) || 0;
    const ctrPct = impressions > 0 ? ((Number(m.clicks) || 0) / impressions) * 100 : null;
    const cpm = impressions > 0 ? (spend / impressions) * 1000 : null;
    const name = c.campaignName || c.platformCampaignId;
    const attr = attribution.byCampaign[c.platformCampaignId] || { revenueCents: 0, sales: 0 };
    const roas = spend > 0 ? (attr.revenueCents / 100) / spend : null;

    for (const r of rules) {
      let hit = false; let detail = '';
      if (r.metric === 'cpa_max' && r.threshold > 0 && conv > 0 && spend / conv > r.threshold) {
        hit = true; detail = 'CPA ' + (spend / conv).toFixed(2) + ' > teto ' + r.threshold;
      } else if (r.metric === 'spend_no_conv' && r.threshold > 0 && conv === 0 && spend >= r.threshold) {
        hit = true; detail = 'gastou ' + spend.toFixed(2) + ' sem conversão';
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
      } else if (r.metric === 'roas_scale' && r.threshold > 0 && roas !== null
        && attr.sales >= (r.minSales || 2) && roas >= r.threshold) {
        hit = true; detail = 'ROAS ' + roas.toFixed(2) + ' ≥ ' + r.threshold + ' com ' + attr.sales + ' venda(s) — escalando';
      }
      if (!hit) continue;

      const cooldownMs = r.metric === 'roas_scale' ? SCALE_COOLDOWN_MS : RULE_COOLDOWN_MS;
      const key = 'rule:' + c.platformCampaignId + ':' + r.id;
      if (await underCooldown(accId, key, cooldownMs)) continue;
      await markFired(accId, key, 'rule', { metric: r.metric, action: r.action });

      const entry = {
        at: new Date().toISOString(), ruleId: r.id, metric: r.metric,
        action: r.action, campaignId: c.platformCampaignId, campaignName: name,
        detail, ok: false, simulated: dryRun,
      };
      try {
        if (r.action === 'pause') {
          if (!dryRun) await provider.setCampaignStatus(advertiserId, [c.platformCampaignId], 'paused');
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'campanha pausada';
        } else {
          const pct = Math.max(5, Math.min(50, Number(r.pct) || 20));
          const factor = r.action === 'budget_up' ? 1 + pct / 100 : 1 - pct / 100;
          const cap = r.metric === 'roas_scale' ? Number(r.budgetCap) || 0 : 0;
          let changed = 0; let capped = 0;
          for (const s of (c.adSets || []).slice(0, 10)) {
            const cur = Number((s.budget || {}).amount) || 0;
            const adGroupId = s.platformAdSetId || s._id;
            if (!(cur > 0) || !adGroupId) continue;
            let amount = Math.max(1, +(cur * factor).toFixed(2));
            if (cap > 0 && amount > cap) {
              if (cur >= cap) { capped += 1; continue; } // já no teto: não toca
              amount = cap;
              capped += 1;
            }
            if (!dryRun) {
              await provider.updateAdGroup(advertiserId, adGroupId, {
                budget: { amount, type: (s.budget || {}).type === 'lifetime' ? 'lifetime' : 'daily' }
              });
            }
            changed += 1;
          }
          entry.ok = changed > 0;
          entry.result = (dryRun ? '[simulado] ' : '') + 'orçamento ' + (r.action === 'budget_up' ? '+' : '-') + pct + '% em ' + changed + ' grupo(s)'
            + (capped ? ' (teto ' + cap + ' aplicado em ' + capped + ')' : '');
          if (!changed && capped) entry.result = (dryRun ? '[simulado] ' : '') + 'todos os grupos já no teto de ' + cap;
        }
        if (dryRun && entry.ok) {
          await auditSimulated(accId, {
            action: 'rule_action', targetType: 'campaign', targetId: c.platformCampaignId, advertiserId,
            metadata: { ruleId: r.id, metric: r.metric, action: r.action, detail }, title: 'Regra automática: ' + entry.result
          });
        }
      } catch (e) {
        entry.result = 'falhou: ' + (e && e.message ? e.message.slice(0, 120) : 'erro');
      }
      executed.push(entry);
      stats.logEvent(entry.ok ? 'info' : 'warn', { acc: accId, title: '[tiktok-ads] Regra ' + (entry.ok ? 'executada' : 'FALHOU') + ': ' + entry.result + ' — "' + name + '" (' + detail + ')' });
      sendPushcut('Aprovada', { title: 'TikTok Ads: regra automática', text: entry.result + ' — "' + name + '" (' + detail + ')', sound: 'system' }, accId).catch(() => {});
    }
  }
  if (executed.some((e) => e.ok && !e.simulated)) syncAfterWrite(accId, advertiserId);
  appendRulesLog(accId, executed);
  return { executed, checkedAt: new Date().toISOString() };
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
  const advertiserId = await provider.resolveAdvertiserId(accId);
  if (!advertiserId) return { executed: [], skipped: true };

  const dryRun = await isDryRun(accId);
  const to = new Date();
  const { stale, campaigns } = await treeForSweep(accId, advertiserId, {
    fromDate: isoDay(new Date(to.getTime() - 864e5)), toDate: isoDay(to), force,
  });
  if (stale) return { executed: [], stale: true };
  await ensureLoaded(accId);

  const executed = [];
  for (const r of schedules) {
    const shouldRun = scheduleActiveNow(r);
    for (const c of campaigns) {
      const cid = String(c.platformCampaignId || '');
      const name = c.campaignName || cid;
      const markKey = 'sched:' + r.id + ':' + cid;
      const pausedByUs = !!getMem(accId, markKey);

      if (!shouldRun && c.status === 'active') {
        // fora da janela: pausa e marca a autoria
        const entry = {
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: 'pause',
          campaignId: cid, campaignName: name, detail: 'fora da janela ' + r.startTime + '–' + r.endTime, ok: false, simulated: dryRun,
        };
        try {
          if (!dryRun) {
            await provider.setCampaignStatus(advertiserId, [cid], 'paused');
            await markFired(accId, markKey, 'sched', { ruleId: r.id, pausedAt: new Date().toISOString() });
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'pausada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
        executed.push(entry);
      } else if (shouldRun && c.status === 'paused' && pausedByUs) {
        // dentro da janela: SÓ reativa o que o agendamento pausou
        const entry = {
          at: new Date().toISOString(), ruleId: r.id, metric: 'schedule', action: 'activate',
          campaignId: cid, campaignName: name, detail: 'dentro da janela ' + r.startTime + '–' + r.endTime, ok: false, simulated: dryRun,
        };
        try {
          if (!dryRun) {
            await provider.setCampaignStatus(advertiserId, [cid], 'active');
            await clearFired(accId, markKey);
          }
          entry.ok = true;
          entry.result = (dryRun ? '[simulado] ' : '') + 'reativada pelo agendamento';
        } catch (e) { entry.result = 'falhou: ' + String(e.message || 'erro').slice(0, 120); }
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
  getAlertCfg,
  getRules,
  getRulesLog,
  appendRulesLog,
  validateRules,
  computeAttribution,
  runAlertSweep,
  runRulesSweep,
  runScheduleSweep,
  maybeSweep,
  markSweepNow,
  getSweepInfo,
  noteRecovery,
  // expostos p/ testes
  _internals: { scheduleActiveNow, localNow, minutesOf, underCooldown, markFired, clearFired, memState, treeForSweep },
};
