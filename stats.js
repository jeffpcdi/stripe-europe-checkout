const fs = require('fs');
const path = require('path');
const db = require('./db');

// ── Store de estatísticas ──────────────────────────────────────────────────
// REMODELADO: o estado agora vive EM MEMÓRIA (fonte quente) e é persistido:
//   1. no Neon (write-through assíncrono, fonte de verdade durável);
//   2. em arquivo JSON local (snapshot debounced, apenas fallback/diagnóstico).
// Antes, cada evento lia e regravava o arquivo inteiro de forma síncrona —
// O(n) por hit e propenso a corrupção sob concorrência. Agora cada operação
// é O(1) em memória e o disco é tocado no máximo 1x por segundo.
const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'stats.json');

// Cache quente (o banco Neon guarda o histórico completo, sem limite).
const MAX_EVENTS = 3000; // mantém os últimos N eventos no feed local
const MAX_LEADS = 8000;  // mantém os últimos N leads rastreados no cache local

const FLUSH_MS = 1000; // debounce do snapshot em disco

function emptyState() {
  return { events: [], leads: [], updatedAt: null };
}

function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Estado em memória + índice de leads por id (busca O(1)) ───────────────
let state = null;
let leadIndex = new Map(); // id -> lead (referência ao objeto em state.leads)
// Item 450: índices O(1) por contato normalizado, com chave `${acc}|${norm}`
// (isolam contas). Guardam o lead MAIS RECENTE com aquele contato — mesma
// semântica dos finds O(n) antigos (state.leads é unshift, índice 0 = novo).
let emailIndex = new Map(); // `${acc}|${email}` -> lead
let phoneIndex = new Map(); // `${acc}|${tail9}` -> lead

function rebuildIndex() {
  leadIndex = new Map();
  emailIndex = new Map();
  phoneIndex = new Map();
  // state.leads é do mais novo pro mais velho; newestWins=false preserva o
  // PRIMEIRO visto (= mais recente) em cada chave de contato (item 450).
  (state.leads || []).forEach((l) => {
    if (!l || !l.id) return;
    leadIndex.set(l.id, l);
    indexLeadContacts(l, false);
  });
}

function loadFromDisk() {
  const s = emptyState();
  try {
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      s.events = Array.isArray(raw.events) ? raw.events : [];
      s.leads = Array.isArray(raw.leads) ? raw.leads : [];
      s.updatedAt = raw.updatedAt || null;
    }
  } catch (err) {
    console.error('[stats] Erro ao ler snapshot, iniciando vazio:', err.message);
  }
  return s;
}

function ensureLoaded() {
  if (state) return;
  state = loadFromDisk();
  rebuildIndex();
}

// ── Snapshot em disco (assíncrono + debounced; nunca bloqueia requests) ────
let flushTimer = null;
let flushing = false;
let dirtyAgain = false;

function flushToDisk() {
  if (flushing) { dirtyAgain = true; return; }
  flushing = true;
  const payload = JSON.stringify(state);
  const tmp = FILE + '.tmp';
  fs.mkdir(DATA_DIR, { recursive: true }, () => {
    // grava em arquivo temporário + rename atômico (evita snapshot corrompido)
    fs.writeFile(tmp, payload, (err) => {
      if (err) { console.error('[stats] Erro ao gravar snapshot:', err.message); flushing = false; return; }
      fs.rename(tmp, FILE, (err2) => {
        flushing = false;
        if (err2) console.error('[stats] Erro no rename do snapshot:', err2.message);
        if (dirtyAgain) { dirtyAgain = false; scheduleFlush(); }
      });
    });
  });
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => { flushTimer = null; flushToDisk(); }, FLUSH_MS);
}

function markDirty() {
  ensureLoaded();
  state.updatedAt = new Date().toISOString();
  scheduleFlush();
}

// Flush final no shutdown para não perder o último segundo de dados.
function flushSync() {
  try {
    if (!state) return;
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(state));
  } catch (_) {}
}

// ── Feed de eventos (venda, recusa, reembolso, disputa, lead, etc.) ───────
// Multi-tenant: o campo `acc` (accountId) em data escopa o evento à conta.
function logEvent(type, data) {
  ensureLoaded();
  const entry = Object.assign({
    id: newId('evt'),
    type: type || 'info',
    at: new Date().toISOString()
  }, data || {});
  state.events.unshift(entry);
  if (state.events.length > MAX_EVENTS) state.events.length = MAX_EVENTS;
  markDirty();
  invalidateStatsCache();
  db.insertEvent(entry.acc || null, entry);
  return entry;
}

// ── Leads ──────────────────────────────────────────────────────────────────
function findLead(id) {
  if (!id) return null;
  ensureLoaded();
  return leadIndex.get(id) || null;
}

// Item 450: normalizadores das chaves de match do webhook. Mesma regra dos
// finds antigos: e-mail lowercase/trim; telefone só dígitos, sem 00, e a
// comparação usa os ÚLTIMOS 9 dígitos (ignora DDI/formatação).
function normEmailKey(email) {
  const e = String(email || '').trim().toLowerCase();
  return e || null;
}
function normPhoneKey(phone) {
  const digits = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  return digits.length >= 8 ? digits.slice(-9) : null;
}
function contactKey(acc, norm) { return (acc || '') + '|' + norm; }

// Item 450: registra o lead nos índices de contato. newestWins=true para
// escritas ao vivo (lead novo substitui o antigo com o mesmo contato);
// false no rebuild, que percorre do mais novo pro mais velho.
function indexLeadContacts(lead, newestWins) {
  if (!lead) return;
  const e = normEmailKey(lead.email);
  if (e) {
    const k = contactKey(lead.acc, e);
    if (newestWins || !emailIndex.has(k)) emailIndex.set(k, lead);
  }
  const p = normPhoneKey(lead.phone);
  if (p) {
    const k = contactKey(lead.acc, p);
    if (newestWins || !phoneIndex.has(k)) phoneIndex.set(k, lead);
  }
}
function unindexLeadContacts(lead) {
  if (!lead) return;
  const e = normEmailKey(lead.email);
  if (e) { const k = contactKey(lead.acc, e); if (emailIndex.get(k) === lead) emailIndex.delete(k); }
  const p = normPhoneKey(lead.phone);
  if (p) { const k = contactKey(lead.acc, p); if (phoneIndex.get(k) === lead) phoneIndex.delete(k); }
}

function addLead(lead) {
  state.leads.unshift(lead);
  leadIndex.set(lead.id, lead);
  indexLeadContacts(lead, true); // item 450
  if (state.leads.length > MAX_LEADS) {
    const removed = state.leads.splice(MAX_LEADS);
    removed.forEach((l) => {
      if (!l) return;
      if (l.id) leadIndex.delete(l.id);
      unindexLeadContacts(l); // item 450: não deixar entrada apontando pra lead podado
    });
  }
  return lead;
}

// ── Jornada do lead: páginas/passos percorridos até a compra ───────────────
// Passos: pathname da página (interna ou externa) ou marcos "go:slug"/"compra".
// Sem passos consecutivos repetidos; cap de 30 (mantém os mais recentes).
function pushJourney(lead, step) {
  if (!lead || !step) return;
  const p = String(step).slice(0, 200);
  lead.journey = lead.journey || [];
  const last = lead.journey[lead.journey.length - 1];
  if (last && last.p === p) { last.at = new Date().toISOString(); return; }
  lead.journey.push({ p, at: new Date().toISOString() });
  if (lead.journey.length > 30) lead.journey = lead.journey.slice(-30);
}

// ── Clique em elemento marcado (data-track="nome") — vira passo da jornada
// "80 viram a VSL mas só 12 clicaram no botão" = problema na página ou na oferta.
function recordClickStep(id, name) {
  ensureLoaded();
  const lead = findLead(id);
  if (!lead) return null;
  pushJourney(lead, 'click:' + String(name).slice(0, 60));
  lead.lastSeen = new Date().toISOString();
  markDirty();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// ── FUNIL: entrada de um visitante no site (topo do funil) ────────────────
function recordVisit(data) {
  data = data || {};
  ensureLoaded();
  let lead = findLead(data.id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({
      id: data.id || newId('ld'),
      acc: data.acc || null, // conta dona do lead (multi-tenant)
      at: nowIso,
      stage: 'visit',
      status: 'pending',
      gateway: null,
      ip: data.ip || null,
      ua: data.ua || null,
      device: data.device || null, os: data.os || null, browser: data.browser || null,
      referer: data.referer || null,
      country: data.country || null,
      countryName: data.countryName || null,
      city: data.city || null,
      landing: data.landing || null,
      site: data.site || null, // domínio da página externa — separa funis/produtos
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    // enriquece dados que faltavam
    ['ip', 'ua', 'device', 'os', 'browser', 'referer', 'country', 'countryName', 'city', 'ttclid', 'site', 'acc'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    if (data.utm && (!lead.utm || !lead.utm.source) && data.utm.source) lead.utm = data.utm;
    lead.lastSeen = nowIso;
  }
  pushJourney(lead, data.landing);
  markDirty();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// ── FUNIL: lead chegou a um checkout (via /go/:slug ou gateway externo) ────
function recordCheckoutEntry(id, gateway, data) {
  data = data || {};
  ensureLoaded();
  let lead = findLead(id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({
      id: id || newId('ld'),
      acc: data.acc || null,
      at: nowIso,
      stage: 'checkout',
      status: 'pending',
      gateway: gateway || null,
      ip: data.ip || null,
      ua: data.ua || null,
      device: data.device || null, os: data.os || null, browser: data.browser || null,
      referer: data.referer || null,
      country: data.country || null,
      countryName: data.countryName || null,
      city: data.city || null,
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    if (lead.stage !== 'purchased') lead.stage = 'checkout';
    lead.gateway = gateway || lead.gateway;
    // email/phone: o gateway manda no PIX gerado — essenciais para o match
    // da conversão futura (fallback por e-mail/telefone) e para a CAPI
    ['ip', 'ua', 'device', 'os', 'browser', 'referer', 'country', 'countryName', 'city', 'ttclid', 'email', 'phone', 'customer', 'acc'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    if (data.utm && data.utm.source && (!lead.utm || !lead.utm.source)) lead.utm = data.utm;
  }
  lead.checkoutAt = nowIso;
  // Item 302: "iniciou pagamento" ≠ "visitou o checkout". Só o webhook do
  // gateway (InitiateCheckout/AddPaymentInfo = PIX gerado / cartão digitado)
  // passa paymentStarted:true — o hit de página no /go/:slug NÃO marca.
  if (data.paymentStarted && !lead.paymentStartedAt) lead.paymentStartedAt = nowIso;
  if (data.expectedAmount) { lead.expectedAmount = data.expectedAmount; lead.expectedCurrency = data.expectedCurrency; }
  // histórico de checkouts que o lead entrou
  lead.checkoutHits = (lead.checkoutHits || []);
  lead.checkoutHits.push({ gateway, at: nowIso });
  if (lead.checkoutHits.length > 10) lead.checkoutHits = lead.checkoutHits.slice(-10);
  pushJourney(lead, 'go:' + (gateway || 'checkout'));
  markDirty();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// Guarda dados de tracking sensíveis (ex.: tt_url REAL) no lead, no servidor.
// Só usados no TikTok Events API (CAPI) — nunca expostos ao cliente.
function attachTracking(id, patch) {
  if (!id || !patch) return null;
  ensureLoaded();
  let lead = findLead(id);
  const nowIso = new Date().toISOString();
  if (!lead) {
    lead = addLead({ id, acc: patch.acc || null, at: nowIso, stage: 'checkout', status: 'pending', gateway: null, utm: {} });
  }
  if (patch.acc && !lead.acc) lead.acc = patch.acc;
  if (patch.ttUrl) lead.ttUrl = String(patch.ttUrl).slice(0, 500);
  if (patch.ttclid && !lead.ttclid) lead.ttclid = patch.ttclid;
  if (patch.ttp) lead.ttp = patch.ttp;
  // Sinais do challenge de cloaking (persistidos pelo /api/cloakcheck)
  if (patch.cloakChallenge) lead.cloakChallenge = patch.cloakChallenge;
  if (patch.cloakChallengeAt) lead.cloakChallengeAt = patch.cloakChallengeAt;
  if (patch.cloakWebgl) lead.cloakWebgl = patch.cloakWebgl;
  if (patch.cloakTz) lead.cloakTz = patch.cloakTz;
  if (patch.cloakFp) lead.cloakFp = patch.cloakFp;
  if (typeof patch.cloakDt === 'number') lead.cloakDt = patch.cloakDt;
  if (typeof patch.cloakBeh === 'number') lead.cloakBeh = patch.cloakBeh;
  // Advanced Matching: email/telefone capturados em formulários da página
  // (snippet /t.js) — sobem o Event Match Quality de TODOS os disparos futuros
  if (patch.email && !lead.email) { lead.email = String(patch.email).slice(0, 320); indexLeadContacts(lead, true); } // item 450
  if (patch.phone && !lead.phone) { lead.phone = String(patch.phone).slice(0, 30); indexLeadContacts(lead, true); } // item 450
  // atribuição de link de checkout (/go/:slug) — usada no webhook universal
  if (patch.linkSlug) lead.linkSlug = String(patch.linkSlug).slice(0, 80);
  if (patch.linkVariant) lead.linkVariant = String(patch.linkVariant).slice(0, 80);
  markDirty();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// Recupera um lead por id (usado no webhook para obter a tt_url real).
function getLead(id) {
  return findLead(id);
}

// Item 302: pagamento recusado também é "iniciou pagamento" — o cliente
// chegou a submeter o cartão/PIX. Chamado pelo webhook Failed quando o
// lead foi identificado (leadId/e-mail/telefone).
function markPaymentStarted(id) {
  ensureLoaded();
  const lead = findLead(id);
  if (!lead || lead.paymentStartedAt) return lead;
  lead.paymentStartedAt = new Date().toISOString();
  markDirty();
  invalidateStatsCache();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// Busca o lead mais recente com um e-mail — fallback de match do webhook
// universal quando o gateway não devolve o leadId.
// Item 450: era O(n) por conta a cada webhook; agora é lookup O(1) no
// emailIndex (chave `${acc}|${email}` normalizada, mais recente vence).
function findLeadByEmail(email, accountId) {
  ensureLoaded();
  const needle = normEmailKey(email);
  if (!needle) return null;
  return emailIndex.get(contactKey(accountId, needle)) ||
    // fallback: leads antigos podem estar indexados sem conta (acc null)
    (accountId ? emailIndex.get(contactKey(null, needle)) || null : null);
}

// Busca por telefone — 3º fallback do webhook (leadId → email → phone).
// Item 450: lookup O(1) no phoneIndex (últimos 9 dígitos, sem 00/DDI).
function findLeadByPhone(phone, accountId) {
  ensureLoaded();
  const tail = normPhoneKey(phone);
  if (!tail) return null;
  return phoneIndex.get(contactKey(accountId, tail)) ||
    (accountId ? phoneIndex.get(contactKey(null, tail)) || null : null);
}

// ── Convers��o de gateway externo (Kiwify, Hotmart, PerfectPay, …) ─────────
// Chamada pelo webhook universal. Resolve o lead (leadId → e-mail → telefone
// → órfão), marca como comprado e guarda o nome real do gateway no lead.
function matchExternalConversion(data) {
  data = data || {};
  ensureLoaded();
  const cur = (data.currency || 'eur').toUpperCase();
  const amount = data.amountCents || 0;
  const nowIso = new Date().toISOString();
  const gw = String(data.gateway || 'externo').toLowerCase().slice(0, 30);
  const acc = data.acc || null;

  // match: leadId direto → e-mail → telefone (webhook universal).
  // Com conta definida, o lead por id só vale se pertencer à MESMA conta.
  let lead = findLead(data.leadId);
  if (lead && acc && lead.acc && lead.acc !== acc) lead = null;
  if (!lead) lead = (data.email ? findLeadByEmail(data.email, acc) : null) ||
    (data.phone ? findLeadByPhone(data.phone, acc) : null);

  if (lead) {
    if (lead.status === 'converted') {
      lead.duplicateReports = (lead.duplicateReports || 0) + 1;
    } else {
      lead.status = 'converted';
    }
    lead.stage = 'purchased';
    lead.gateway = gw;
    if (acc && !lead.acc) lead.acc = acc;
    // Item 302: compra aprovada implica pagamento iniciado (se o gateway
    // não mandou InitiateCheckout antes, marcamos retroativamente aqui)
    if (!lead.paymentStartedAt) lead.paymentStartedAt = nowIso;
    lead.convertedAt = nowIso;
    lead.reportedAmount = amount;
    lead.reportedCurrency = cur;
    lead.customer = data.customer || lead.customer || null;
    lead.email = data.email || lead.email || null;
    lead.phone = data.phone || lead.phone || null;
    indexLeadContacts(lead, true); // item 450: contato do gateway entra no índice
    lead.ref = data.ref || lead.ref || null;
    lead.orphan = false;
  } else {
    // Item 449: conversão órfã não é mais silenciosa — registra POR QUE não
    // casou (quais chaves de match o gateway mandou vs. o que faltou), para
    // alimentar o toggle de órfãs (item 312) e o diagnóstico de atribuição.
    const tried = [];
    if (data.leadId) tried.push('leadId');
    if (data.email) tried.push('email');
    if (data.phone) tried.push('telefone');
    const reason = tried.length === 0
      ? 'gateway não enviou nenhuma chave de identificação (sem leadId, e-mail ou telefone)'
      : 'nenhum lead rastreado casou com ' + tried.join(' / ') + ' (visitante não passou pelo link antes de comprar, ou comprou de outro dispositivo)';
    logEvent('info', {
      acc,
      title: '[atribuição] conversão órfã: ' + reason,
      gateway: gw,
      ref: data.email || data.phone || data.leadId || null,
      orphanReason: tried.length === 0 ? 'sem_chave' : 'sem_match',
      triedKeys: tried
    });
    lead = addLead({
      id: data.leadId || newId('orphan'),
      acc,
      at: nowIso,
      gateway: gw,
      stage: 'purchased',
      status: 'converted',
      orphan: true,
      paymentStartedAt: nowIso, // item 302: venda implica pagamento iniciado
      convertedAt: nowIso,
      reportedAmount: amount,
      reportedCurrency: cur,
      customer: data.customer || null,
      email: data.email || null,
      phone: data.phone || null,
      ref: data.ref || null,
      utm: {}
    });
  }

  pushJourney(lead, 'compra');

  // tempo entre o checkout e a conversão (diagnóstico de atribuição)
  const baseTime = lead.checkoutAt || lead.at;
  lead.conversionAgeMs = lead.orphan
    ? null
    : new Date(lead.convertedAt).getTime() - new Date(baseTime).getTime();

  markDirty();
  invalidateStatsCache();
  db.upsertLead(lead.acc || null, lead);
  return lead;
}

// ── Snapshot agregado para a dashboard (POR CONTA) ─────────────────────────
// Cache curto por conta: /api/stats é chamado em polling; evita reagregar.
const statsCacheMap = new Map(); // accountId -> { out, at }
const STATS_CACHE_MS = 2000;

function getStats(accountId) {
  const cacheKey = accountId || '__all__';
  const now = Date.now();
  const hit = statsCacheMap.get(cacheKey);
  if (hit && (now - hit.at) < STATS_CACHE_MS) return hit.out;
  ensureLoaded();

  // Filtra eventos e leads pela conta (accountId null = visão global/legado)
  const allEvents = (state.events || []).filter((e) => !accountId || e.acc === accountId);
  const allLeads = (state.leads || []).filter((l) => !accountId || l.acc === accountId);
  const out = { events: allEvents, updatedAt: state.updatedAt };

  // ── Totais (derivados do feed de eventos da conta) ──
  const revenue = {};
  let sales = 0, failed = 0, refunds = 0, disputes = 0;
  allEvents.forEach((e) => {
    if (e.type === 'sale') {
      sales++;
      const cur = (e.currency || 'EUR').toUpperCase();
      revenue[cur] = (revenue[cur] || 0) + (e.amount || 0);
    }
    else if (e.type === 'failed') failed++;
    else if (e.type === 'refund') refunds++;
    else if (e.type === 'dispute') disputes++;
  });
  const totalAttempts = sales + failed;
  out.totals = {
    revenue, sales, failed, refunds, disputes,
    approvalRate: totalAttempts ? +((sales / totalAttempts) * 100).toFixed(1) : 0
  };

  // ── Funil (leads da conta) ──
  const leads = allLeads;
  const realLeads = leads.filter((l) => !l.orphan); // leads que originamos
  const visits = realLeads.length;
  const reachedCheckout = realLeads.filter((l) => l.stage === 'checkout' || l.stage === 'purchased').length;
  const purchased = realLeads.filter((l) => l.stage === 'purchased').length;
  // Gateways dinâmicos: qualquer origem vista nos leads vira uma entrada
  const byGateway = {};
  realLeads.forEach((l) => {
    if (!l.gateway) return;
    if (!byGateway[l.gateway]) byGateway[l.gateway] = { checkout: 0, purchased: 0 };
    if (l.stage === 'checkout' || l.stage === 'purchased') byGateway[l.gateway].checkout++;
    if (l.stage === 'purchased') byGateway[l.gateway].purchased++;
  });

  // Dispositivos/navegadores (parse do user-agent feito na entrada do lead)
  const byDevice = {};
  const byBrowser = {};
  realLeads.forEach((l) => {
    if (l.device) {
      if (!byDevice[l.device]) byDevice[l.device] = { visits: 0, purchased: 0 };
      byDevice[l.device].visits++;
      if (l.stage === 'purchased') byDevice[l.device].purchased++;
    }
    if (l.browser) byBrowser[l.browser] = (byBrowser[l.browser] || 0) + 1;
  });
  out.funnel = {
    visits,
    reachedCheckout,
    purchased,
    visitToCheckout: visits ? +((reachedCheckout / visits) * 100).toFixed(1) : 0,
    checkoutToPurchase: reachedCheckout ? +((purchased / reachedCheckout) * 100).toFixed(1) : 0,
    overall: visits ? +((purchased / visits) * 100).toFixed(1) : 0,
    byGateway,
    byDevice,
    byBrowser
  };

  // ── Países (geo dos leads) ──
  const countryMap = {};
  realLeads.forEach((l) => {
    if (!l.country) return;
    if (!countryMap[l.country]) countryMap[l.country] = { code: l.country, name: l.countryName || l.country, count: 0, purchased: 0 };
    countryMap[l.country].count++;
    if (l.stage === 'purchased') countryMap[l.country].purchased++;
  });
  out.countries = Object.values(countryMap).sort((a, b) => b.count - a.count);

  // ── Leads recentes ──
  out.leads = leads.slice(0, 3000); // envia histórico amplo p/ filtros de vários dias

  statsCacheMap.set(cacheKey, { out, at: now });
  return out;
}

function invalidateStatsCache() { statsCacheMap.clear(); }

// Item 324/425 (LGPD): espelho em memória da anonimização — remove
// e-mail/telefone/nome dos leads além da janela e refaz os índices de
// contato (leads anonimizados saem do match por e-mail/telefone).
function anonymizeOldLeads(accountId, days) {
  ensureLoaded();
  if (!accountId || !days) return 0;
  const cutoff = Date.now() - days * 86400e3;
  let n = 0;
  (state.leads || []).forEach((l) => {
    if (!l || l.acc !== accountId || l.anonymized) return;
    const t = new Date(l.at).getTime();
    if (!isFinite(t) || t >= cutoff) return;
    if (l.email == null && l.phone == null && l.customer == null) return;
    unindexLeadContacts(l); // sai do match ANTES de perder as chaves
    delete l.email; delete l.phone; delete l.customer;
    l.anonymized = true;
    n++;
  });
  if (n > 0) {
    invalidateStatsCache();
    markDirty();
  }
  return n;
}

// Zera SOMENTE os dados da conta informada (ou tudo, se accountId omitido).
function reset(accountId) {
  ensureLoaded();
  if (accountId) {
    state.leads = (state.leads || []).filter((l) => l.acc !== accountId);
    state.events = (state.events || []).filter((e) => e.acc !== accountId);
    rebuildIndex();
  } else {
    state = emptyState();
    rebuildIndex();
  }
  invalidateStatsCache();
  markDirty();
  flushToDisk();
  db.reset(accountId);
}

// ── Hidratação do cache a partir do Neon (chamado no boot) ────────────────
// Faz o banco ser a fonte de verdade após um deploy/reinício: o arquivo local
// é efêmero, então recarregamos leads/eventos do Postgres.
async function hydrate() {
  try {
    await db.initWithRetry(3);
    if (!db.enabled) return;
    // Carrega TODAS as contas (cache global; getStats filtra por conta).
    const persisted = await db.loadState(null, MAX_LEADS, MAX_EVENTS);
    if (!persisted) return;
    ensureLoaded();
    // Banco vence sobre o arquivo efêmero (que costuma estar vazio no boot).
    if (persisted.leads && persisted.leads.length) state.leads = persisted.leads.slice(0, MAX_LEADS);
    if (persisted.events && persisted.events.length) state.events = persisted.events.slice(0, MAX_EVENTS);
    rebuildIndex();
    invalidateStatsCache();
    markDirty();
    console.log('[stats] Hidratado do Neon: ' + state.leads.length + ' leads, ' + state.events.length + ' eventos.');
  } catch (err) {
    console.error('[stats] Erro ao hidratar do Neon:', err.message);
  }
}

// ── Quem está "no checkout" AGORA, por gateway ────────────────────────────
// Os checkouts são EXTERNOS (sem como injetar script lá), então estimamos:
// lead que entrou num checkout há menos de `windowMs` (padrão 10 min) e
// ainda não comprou = provavelmente ainda está lá. Chaves dinâmicas por gateway.
function inCheckoutNow(windowMs, accountId) {
  ensureLoaded();
  const cut = Date.now() - (windowMs || 10 * 60 * 1000);
  const out = {};
  (state.leads || []).forEach((l) => {
    if (l.stage !== 'checkout') return;
    if (accountId && l.acc !== accountId) return;
    const t = l.checkoutAt ? new Date(l.checkoutAt).getTime() : 0;
    if (t >= cut) {
      const gw = l.gateway || 'externo';
      out[gw] = (out[gw] || 0) + 1;
    }
  });
  return out;
}

// Garante snapshot final ao encerrar o processo (deploy/restart).
process.once('SIGTERM', flushSync);
process.once('SIGINT', flushSync);
process.once('beforeExit', flushSync);

module.exports = {
  logEvent, recordVisit, recordCheckoutEntry, recordClickStep,
  attachTracking, getLead, findLeadByEmail, findLeadByPhone, matchExternalConversion, getStats, reset, hydrate,
  inCheckoutNow, anonymizeOldLeads, markPaymentStarted
  };
