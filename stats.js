const fs = require('fs');
const path = require('path');
const db = require('./db');

// ═══════════════════════════════════════════════════════════════════════════
// REGRA DE ATRIBUIÇÃO: LAST-CLICK PAGO  (não altere sem decisão de produto)
// ─────────────────────────────────────────────────────────────────────────
// O crédito de uma conversão vai para o ttclid (clique pago do TikTok) MAIS
// RECENTE registrado ANTES do checkoutAt do lead. Consequências no código:
//
//  • lead.clicks = [{ ttclid, utm, at }]  → histórico completo de cliques
//    pagos (cap de 10). NUNCA descartamos cliques: o primeiro fica no histórico
//    para análise; o vencedor é recalculado por applyLastClickPaid().
//  • lead.ttclid / lead.utm  → SEMPRE apontam para o clique vencedor
//    (last-click pago). Um clique novo na campanha B substitui o crédito da
//    campanha A (enquanto ocorrer antes do checkout).
//  • Match do webhook: ttclid é a 1ª tentativa (determinística), na ordem
//    ttclid → leadId → email → phone → órfã.
//
// Se precisar de OUTRA regra (first-click, multi-touch…), mude aqui de forma
// explícita — não reintroduza "preencher só se vazio", que silenciosamente
// congelava o crédito no primeiro clique (Risco 4 da auditoria).
// ═══════════════════════════════════════════════════════════════════════════

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
// (isolam contas). Risco 1: guardam a LISTA de leads com aquele contato (Set),
// não só o mais recente — o mesmo e-mail pode ter leads de campanhas diferentes
// e a escolha do vencedor passa a considerar intenção de compra + recência.
let emailIndex = new Map(); // `${acc}|${email}` -> Set<lead>
let phoneIndex = new Map(); // `${acc}|${tail9}` -> Set<lead>
// Risco 5: dedup em memória de vendas órfãs por pedido (defesa em profundidade
// para quando o dedup durável do Neon não se aplica — banco off ou sem order_id
// no evId). `${acc}|${gateway}|${orderId}` -> lead órfão já criado.
let orphanOrderIndex = new Map();
// Poda silenciosa (auditoria): contadores acumulados de itens descartados do
// cache quente por exceder o cap. NÃO é perda de dados (leads/eventos seguem no
// Neon e o Risco 7 re-hidrata leads antigos sob demanda), mas precisa ser
// VISÍVEL no Diagnóstico — antes o descarte era silencioso. lastAt = quando
// ocorreu a última poda; total = quantos foram podados desde o boot.
const pruneStats = { leads: 0, events: 0, leadsLastAt: null, eventsLastAt: null };
// Risco 3: índice O(1) de ttclid → Set<lead>, chave `${acc}|${ttclid}`. Guarda
// TODOS os ttclids que o lead já registrou (lead.clicks), não só o vencedor —
// o webhook pode ecoar qualquer um deles e ainda assim casar o lead certo.
let ttclidIndex = new Map();
// Risco 8 (LGPD): contagem de leads ANONIMIZADOS por conta. Se uma venda vira
// órfã e a conta tem leads anonimizados na janela, o comprador PODE ser um lead
// cujo e-mail/telefone foi apagado pela retenção LGPD — não um bug de match.
// Sobrevive a hydrate/rebuild (repopulado abaixo a partir dos leads do Neon).
let anonymizedByAcc = new Map(); // acc -> { count, lastAt }

function noteAnonymized(acc, at) {
  const key = acc || '';
  const cur = anonymizedByAcc.get(key) || { count: 0, lastAt: null };
  cur.count += 1;
  if (at && (!cur.lastAt || at > cur.lastAt)) cur.lastAt = at;
  anonymizedByAcc.set(key, cur);
}

function rebuildIndex() {
  leadIndex = new Map();
  emailIndex = new Map();
  phoneIndex = new Map();
  orphanOrderIndex = new Map();
  ttclidIndex = new Map();
  anonymizedByAcc = new Map();
  // state.leads é do mais novo pro mais velho.
  (state.leads || []).forEach((l) => {
    if (!l || !l.id) return;
    leadIndex.set(l.id, l);
    indexLeadContacts(l, false);
    // Repovoa o índice de órfãs por pedido (mantém o 1º visto = mais recente).
    if (l.orphan && l.ref) {
      const k = orphanKey(l.acc, l.gateway, l.ref);
      if (!orphanOrderIndex.has(k)) orphanOrderIndex.set(k, l);
    }
    // Risco 8: recontabiliza anonimizados após hydrate/rebuild.
    if (l.anonymized) noteAnonymized(l.acc, l.anonymizedAt || l.at);
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
  if (state.events.length > MAX_EVENTS) {
    // Poda silenciosa do feed → agora contabilizada. Não é perda de dados (o
    // evento já foi para o Neon via db.insertEvent abaixo e o arquivamento
    // frio mantém histórico), mas o descarte do feed quente fica visível.
    const dropped = state.events.length - MAX_EVENTS;
    state.events.length = MAX_EVENTS;
    pruneStats.events += dropped;
    pruneStats.eventsLastAt = new Date().toISOString();
    // log amostrado (1 a cada 100 podas) para não poluir sob alto volume
    if (pruneStats.events % 100 < dropped) {
      console.warn('[stats] poda de eventos do feed: total ' + pruneStats.events +
        ' descartado(s) do cache quente desde o boot (cap ' + MAX_EVENTS + '; histórico no Neon).');
    }
  }
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
function orphanKey(acc, gw, orderId) {
  return (acc || '') + '|' + String(gw || '') + '|' + String(orderId || '');
}

// Adiciona/remove um lead num índice de contato baseado em Set (Risco 1: vários
// leads podem compartilhar o mesmo e-mail/telefone). Limpa a chave quando vazia.
function idxAdd(map, key, lead) {
  let s = map.get(key);
  if (!s) { s = new Set(); map.set(key, s); }
  s.add(lead);
}
function idxRemove(map, key, lead) {
  const s = map.get(key);
  if (!s) return;
  s.delete(lead);
  if (s.size === 0) map.delete(key);
}

// Item 450 / Risco 1: registra o lead nos índices de contato (agora listas).
// O parâmetro newestWins deixou de importar para a corretude — guardamos TODOS
// os leads do contato e escolhemos o vencedor na leitura (pickBestCandidate).
function indexLeadContacts(lead, _newestWins) {
  if (!lead) return;
  const e = normEmailKey(lead.email);
  if (e) idxAdd(emailIndex, contactKey(lead.acc, e), lead);
  const p = normPhoneKey(lead.phone);
  if (p) idxAdd(phoneIndex, contactKey(lead.acc, p), lead);
  // Risco 3: indexa TODOS os ttclids conhecidos do lead (vencedor + histórico).
  leadTtclids(lead).forEach((tc) => idxAdd(ttclidIndex, contactKey(lead.acc, tc), lead));
}
function unindexLeadContacts(lead) {
  if (!lead) return;
  const e = normEmailKey(lead.email);
  if (e) idxRemove(emailIndex, contactKey(lead.acc, e), lead);
  const p = normPhoneKey(lead.phone);
  if (p) idxRemove(phoneIndex, contactKey(lead.acc, p), lead);
  leadTtclids(lead).forEach((tc) => idxRemove(ttclidIndex, contactKey(lead.acc, tc), lead));
}
// Conjunto de ttclids que um lead já registrou: o vencedor atual + o histórico
// de cliques. Usado para (des)indexar no ttclidIndex.
function leadTtclids(lead) {
  const out = new Set();
  if (lead && lead.ttclid) out.add(lead.ttclid);
  if (lead && Array.isArray(lead.clicks)) {
    lead.clicks.forEach((c) => { if (c && c.ttclid) out.add(c.ttclid); });
  }
  return out;
}

// Risco 1: escolhe o melhor candidato entre leads que compartilham um contato.
// Prioriza INTENÇÃO real de compra (checkoutAt/paymentStartedAt mais recente),
// desempata pela recência de criação do lead. Retorna também quantos candidatos
// existiam e se pertenciam a CAMPANHAS diferentes (UTMs distintos) — sinal de
// que o crédito é duvidoso e a venda deve ser marcada como ambígua.
function pickBestCandidate(set) {
  const arr = set ? Array.from(set) : [];
  if (arr.length === 0) return { lead: null, candidates: 0, ambiguous: false };
  if (arr.length === 1) return { lead: arr[0], candidates: 1, ambiguous: false };
  const intentTime = (l) => Math.max(
    l && l.checkoutAt ? Date.parse(l.checkoutAt) || 0 : 0,
    l && l.paymentStartedAt ? Date.parse(l.paymentStartedAt) || 0 : 0
  );
  const createdTime = (l) => (l && l.at ? Date.parse(l.at) || 0 : 0);
  const best = arr.slice().sort((a, b) => {
    const d = intentTime(b) - intentTime(a);
    return d !== 0 ? d : createdTime(b) - createdTime(a);
  })[0];
  const campaignOf = (l) => {
    const u = (l && l.utm) || {};
    return [u.source, u.medium, u.campaign, u.content, u.term]
      .map((x) => (x == null ? '' : String(x))).join('|');
  };
  const campaigns = new Set(arr.map(campaignOf));
  return { lead: best, candidates: arr.length, ambiguous: campaigns.size > 1 };
}

// Junta os candidatos de e-mail e telefone da MESMA conta e escolhe o melhor.
function findContactCandidates(acc, email, phone) {
  ensureLoaded();
  const set = new Set();
  const e = normEmailKey(email);
  if (e) { const s = emailIndex.get(contactKey(acc, e)); if (s) s.forEach((l) => set.add(l)); }
  const p = normPhoneKey(phone);
  if (p) { const s = phoneIndex.get(contactKey(acc, p)); if (s) s.forEach((l) => set.add(l)); }
  return pickBestCandidate(set);
}

// Risco 3: lead com um ttclid específico (match determinístico do webhook).
function findLeadByTtclid(ttclid, acc) {
  ensureLoaded();
  if (!ttclid) return null;
  return pickBestCandidate(ttclidIndex.get(contactKey(acc, ttclid))).lead;
}

// ── ATRIBUIÇÃO LAST-CLICK PAGO (ver cabeçalho do arquivo) ──────────────────
// Registra um clique PAGO (com ttclid) no histórico do lead. NÃO descarta
// cliques anteriores (Risco 4): o primeiro fica no histórico para análise; o
// vencedor é recalculado por applyLastClickPaid. Cliques sem ttclid não são
// "pagos" e não entram aqui (não sobrescrevem o crédito pago).
function recordClick(lead, click) {
  if (!lead || !click || !click.ttclid) return;
  const at = click.at || new Date().toISOString();
  const utm = (click.utm && typeof click.utm === 'object') ? click.utm : {};
  // A atribuição CONGELA no checkout: um clique que chega DEPOIS de o checkout
  // já ter ocorrido entra no histórico (para análise), mas não muda o crédito.
  // Decidido por ORDEM de eventos, não por timestamp — imune a colisão de ms.
  // (O clique do próprio /go é registrado ANTES de checkoutAt em
  // recordCheckoutEntry, então ainda conta como último clique pago.)
  const frozen = !!lead.checkoutAt;
  lead.clicks = Array.isArray(lead.clicks) ? lead.clicks : [];
  const last = lead.clicks[lead.clicks.length - 1];
  if (last && last.ttclid === click.ttclid) {
    // mesmo clique reaparecendo (reload/navegação): atualiza timestamp/utm
    last.at = at;
    if (utm.source) last.utm = utm;
  } else {
    lead.clicks.push({ ttclid: click.ttclid, utm: utm, at: at });
    if (lead.clicks.length > 10) lead.clicks = lead.clicks.slice(-10); // cap 10
  }
  // indexa o novo ttclid para match O(1) do webhook (mesmo se congelado: o
  // webhook pode ecoar qualquer clique do histórico e ainda casar este lead)
  idxAdd(ttclidIndex, contactKey(lead.acc, click.ttclid), lead);
  if (!frozen) applyLastClickPaid(lead);
}

// Elege o clique vencedor = o ttclid MAIS RECENTE do histórico (last-click
// pago). Só é chamado ANTES/no checkout (depois a atribuição está congelada),
// então "mais recente" já respeita a regra "antes do checkoutAt". Atualiza
// lead.ttclid e lead.utm juntos (par coerente).
function applyLastClickPaid(lead) {
  if (!lead || !Array.isArray(lead.clicks) || !lead.clicks.length) return;
  const winner = lead.clicks[lead.clicks.length - 1]; // o mais recente registrado
  lead.ttclid = winner.ttclid;
  if (winner.utm && winner.utm.source) lead.utm = winner.utm;
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
      // Risco 5: idem para o índice de órfãs por pedido.
      if (l.orphan && l.ref) {
        const k = orphanKey(l.acc, l.gateway, l.ref);
        if (orphanOrderIndex.get(k) === l) orphanOrderIndex.delete(k);
      }
    });
    // Poda silenciosa → agora deixa rastro. Alerta se um COMPRADOR foi podado
    // (ainda recuperável do Neon via findLeadsByContact no match, mas é sinal
    // de cache subdimensionado para o volume da conta).
    pruneStats.leads += removed.length;
    pruneStats.leadsLastAt = new Date().toISOString();
    const convictedOut = removed.filter((l) => l && l.status === 'converted').length;
    console.warn('[stats] poda de leads: ' + removed.length + ' removido(s) do cache (cap ' + MAX_LEADS +
      '), ' + convictedOut + ' comprador(es). Total podado desde o boot: ' + pruneStats.leads +
      '. (Dados seguem no Neon; match usa fallback no banco.)');
  }
  return lead;
}

// Risco 7: re-hidrata no cache um lead vindo do Neon (fallback de match). Se já
// existe em memória (mesmo id), devolve o do cache — não duplica. Depois de
// ingerir, os índices sync (e-mail/telefone/ttclid) casam normalmente e o
// match não cria órfã de um comprador que só estava frio no banco.
function ingestLead(leadData) {
  if (!leadData || !leadData.id) return null;
  ensureLoaded();
  const existing = leadIndex.get(leadData.id);
  if (existing) return existing;
  return addLead(leadData);
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
      // Histórico compacto de hospedagens vistas pelo mesmo visitante. O campo
      // `site` legado guarda só a primeira; `sites` permite diagnosticar a
      // passagem por landing, VSL, checkout e upsell em domínios diferentes.
      sites: data.site ? [{ host: String(data.site).slice(0, 100), firstAt: nowIso, lastAt: nowIso, hits: 1 }] : [],
      pixelSlug: data.pixelSlug || null, // destino TikTok que originou esta jornada
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    // enriquece dados que faltavam (ttclid/utm NÃO entram aqui: são last-click
    // pago, tratados por recordClick abaixo — ver cabeçalho do arquivo)
    ['ip', 'ua', 'device', 'os', 'browser', 'referer', 'country', 'countryName', 'city', 'site', 'acc'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    // organico (sem ttclid): rede de segurança p/ não perder o 1º utm orgânico.
    // Um clique pago posterior sempre sobrepõe via applyLastClickPaid.
    if (!data.ttclid && data.utm && (!lead.utm || !lead.utm.source) && data.utm.source) lead.utm = data.utm;
    // A tag específica é uma evidência explícita de roteamento. Mantemos a
    // última tag vista para que checkout e webhook continuem no mesmo pixel.
    if (data.pixelSlug) lead.pixelSlug = String(data.pixelSlug).slice(0, 40);
    if (data.site) {
      const host = String(data.site).slice(0, 100);
      lead.sites = Array.isArray(lead.sites) ? lead.sites : [];
      if (!lead.sites.length && lead.site) {
        lead.sites.push({ host: String(lead.site).slice(0, 100), firstAt: lead.at || nowIso, lastAt: lead.lastSeen || nowIso, hits: 1 });
      }
      let siteRow = lead.sites.find((row) => row && row.host === host);
      if (!siteRow) {
        siteRow = { host, firstAt: nowIso, lastAt: nowIso, hits: 1 };
        lead.sites.push(siteRow);
      } else {
        const previous = Date.parse(siteRow.lastAt || '') || 0;
        // /t.js e /px/TOKEN.js podem registrar a mesma visita quase juntos.
        // Uma janela curta impede contar as duas entregas como duas pageviews.
        if (Date.now() - previous > 2000) siteRow.hits = Math.max(1, Number(siteRow.hits) || 1) + 1;
        siteRow.lastAt = nowIso;
      }
      lead.sites = lead.sites
        .filter((row) => row && row.host)
        .sort((a, b) => Date.parse(b.lastAt || '') - Date.parse(a.lastAt || ''))
        .slice(0, 10);
    }
    lead.lastSeen = nowIso;
  }
  // Risco 4: registra o clique pago no histórico (last-click pago).
  recordClick(lead, { ttclid: data.ttclid, utm: data.utm, at: nowIso });
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
      pixelSlug: data.pixelSlug || null,
      ttclid: data.ttclid || null,
      utm: data.utm || {}
    });
  } else {
    if (lead.stage !== 'purchased') lead.stage = 'checkout';
    lead.gateway = gateway || lead.gateway;
    // email/phone: o gateway manda no PIX gerado — essenciais para o match
    // da conversão futura (fallback por e-mail/telefone) e para a CAPI
    // ttclid/utm NÃO entram aqui: são last-click pago (recordClick abaixo)
    ['ip', 'ua', 'device', 'os', 'browser', 'referer', 'country', 'countryName', 'city', 'email', 'phone', 'customer', 'acc'].forEach((k) => {
      if (!lead[k] && data[k]) lead[k] = data[k];
    });
    if (!data.ttclid && data.utm && data.utm.source && (!lead.utm || !lead.utm.source)) lead.utm = data.utm;
    if (data.pixelSlug) lead.pixelSlug = String(data.pixelSlug).slice(0, 40);
  }
  // Risco 4: o clique do /go é o ÚLTIMO clique pago antes do checkout. Registra
  // ANTES de setar checkoutAt para que ele vire o vencedor (last-click pago);
  // só depois a atribuição congela. A ordem dos eventos é o que decide.
  recordClick(lead, { ttclid: data.ttclid, utm: data.utm, at: nowIso });
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
  // Risco 4: NÃO congela o primeiro ttclid — registra como clique pago no
  // histórico e deixa o last-click pago decidir o vencedor (ver cabeçalho).
  if (patch.ttclid) recordClick(lead, { ttclid: patch.ttclid, utm: patch.utm, at: nowIso });
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
  if (patch.pixelSlug) lead.pixelSlug = String(patch.pixelSlug).slice(0, 40);
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
  // Risco 2: match ESTRITO por conta (fallback contactKey(null,…) removido).
  // Risco 1: o índice agora é um Set — escolhe o melhor por intenção/recência.
  return pickBestCandidate(emailIndex.get(contactKey(accountId, needle))).lead;
}

// Busca por telefone — 3º fallback do webhook (leadId → email → phone).
// Item 450: lookup O(1) no phoneIndex (últimos 9 dígitos, sem 00/DDI).
function findLeadByPhone(phone, accountId) {
  ensureLoaded();
  const tail = normPhoneKey(phone);
  if (!tail) return null;
  // Risco 2: estrito por conta. Risco 1: Set → melhor candidato.
  return pickBestCandidate(phoneIndex.get(contactKey(accountId, tail))).lead;
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

  // Risco 3: ORDEM de match → ttclid → leadId → e-mail → telefone → órfã.
  // O ttclid é a 1ª tentativa: é o clique pago (determinístico e já escopado
  // por conta em findByTtclid), a chave mais forte que o gateway pode ecoar.
  let lead = data.ttclid ? findLeadByTtclid(data.ttclid, acc) : null;
  // leadId direto: com conta definida, só vale se pertencer à MESMA conta.
  if (!lead) {
    lead = findLead(data.leadId);
    // Risco 2: fronteira ESTRITA (null só casa com null). findLead(id) resolve
    // por id sem escopo de conta; o guard impede o cruzamento entre contas.
    if (lead && (lead.acc || null) !== (acc || null)) lead = null;
  }
  // Risco 1: transparência de atribuição. Quando casamos por CONTATO
  // (e-mail/telefone), pode haver >1 lead — registramos quantos e se são de
  // campanhas diferentes (crédito duvidoso). ttclid/leadId direto = 1.
  let candidates = 1;
  let ambiguous = false;
  if (!lead) {
    const pick = findContactCandidates(acc, data.email, data.phone);
    lead = pick.lead;
    candidates = pick.candidates;
    ambiguous = pick.ambiguous;
  }

  // Risco 5 (defesa em profundidade): 2º hit da MESMA venda órfã (retry sem
  // leadId/e-mail casável) reusaria addLead e criaria uma órfã duplicada, com
  // receita dobrada. Se já existe uma órfã para (conta,gateway,orderId),
  // devolve a original marcada como duplicata em vez de criar outra.
  if (!lead && data.ref) {
    const ok = orphanKey(acc, gw, data.ref);
    const existingOrphan = orphanOrderIndex.get(ok);
    if (existingOrphan) {
      existingOrphan.duplicateReports = (existingOrphan.duplicateReports || 0) + 1;
      markDirty();
      return decorateMatch(existingOrphan, { candidates, ambiguous, duplicate: true });
    }
  }

  if (lead) {
    const alreadyConverted = lead.status === 'converted';
    if (alreadyConverted) {
      // Risco 5: retry de uma venda já contabilizada — conta o report e
      // sinaliza duplicata para o caller NÃO re-emitir o evento de receita.
      lead.duplicateReports = (lead.duplicateReports || 0) + 1;
      markDirty();
      invalidateStatsCache();
      db.upsertLead(lead.acc || null, lead);
      return decorateMatch(lead, { candidates, ambiguous, duplicate: true });
    }
    lead.status = 'converted';
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
    if (data.ttclid) tried.push('ttclid');
    if (data.leadId) tried.push('leadId');
    if (data.email) tried.push('email');
    if (data.phone) tried.push('telefone');
    const reason = tried.length === 0
      ? 'gateway não enviou nenhuma chave de identificação (sem leadId, e-mail ou telefone)'
      : 'nenhum lead rastreado casou com ' + tried.join(' / ') + ' (visitante não passou pelo link antes de comprar, ou comprou de outro dispositivo)';
    // Risco 8 (LGPD): se a conta anonimizou leads e o gateway MANDOU contato
    // (e-mail/telefone) que não casou, o comprador pode ser um lead cuja PII
    // foi apagada pela retenção — não um bug de match. Sinaliza para o operador
    // não confundir os dois casos.
    const anon = anonymizedByAcc.get(acc || '');
    const maybeAnon = !!(anon && anon.count > 0) && !!(data.email || data.phone);
    let orphanReason = tried.length === 0 ? 'sem_chave' : 'sem_match';
    let reasonMsg = reason;
    if (maybeAnon) {
      orphanReason = 'possivel_anonimizado';
      reasonMsg = reason + ' — a conta tem ' + anon.count + ' lead(s) anonimizado(s) pela retenção LGPD; ' +
        'o comprador PODE ser um deles (e-mail/telefone apagados), não uma falha de rastreio';
    }
    logEvent('info', {
      acc,
      title: '[atribuição] conversão órfã: ' + reasonMsg,
      gateway: gw,
      ref: data.email || data.phone || data.leadId || null,
      orphanReason,
      triedKeys: tried,
      anonymizedInWindow: maybeAnon ? anon.count : undefined
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
    // Risco 5: indexa a órfã por (conta,gateway,orderId) para reconhecer retries.
    if (data.ref) orphanOrderIndex.set(orphanKey(acc, gw, data.ref), lead);
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
  return decorateMatch(lead, { candidates, ambiguous, duplicate: false });
}

// Risco 1/5: anexa metadados de atribuição ao lead retornado SEM persisti-los.
// Usa propriedades não-enumeráveis para que db.upsertLead (JSON.stringify) as
// ignore ��� elas são só um canal de comunicação com o caller (server.js).
function decorateMatch(lead, meta) {
  if (!lead) return lead;
  try {
    Object.defineProperty(lead, 'matchCandidates', { value: meta.candidates || 1, configurable: true, enumerable: false, writable: true });
    Object.defineProperty(lead, 'matchAmbiguous', { value: !!meta.ambiguous, configurable: true, enumerable: false, writable: true });
    Object.defineProperty(lead, '_duplicate', { value: !!meta.duplicate, configurable: true, enumerable: false, writable: true });
  } catch (_) { /* se falhar, o caller cai nos defaults */ }
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
  // `state.updatedAt` é global ao processo. Expô-lo numa resposta escopada fazia
  // a conta A parecer atualizada quando só a conta B recebeu tráfego e ainda
  // invalidava o ETag de A. O frescor agora nasce exclusivamente dos dados da
  // própria conta, preservando isolamento também nos metadados.
  let scopedUpdatedAt = null, scopedUpdatedMs = -Infinity;
  const considerScopedUpdate = (at) => {
    const ms = Date.parse(at || '');
    if (Number.isFinite(ms) && ms > scopedUpdatedMs) {
      scopedUpdatedMs = ms;
      scopedUpdatedAt = at;
    }
  };
  allEvents.forEach((e) => considerScopedUpdate(e.at));
  allLeads.forEach((l) => {
    [l.lastSeen, l.purchasedAt, l.checkoutAt, l.at].forEach(considerScopedUpdate);
  });
  const out = { events: allEvents, updatedAt: scopedUpdatedAt };

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
    l.anonymizedAt = new Date().toISOString();
    noteAnonymized(accountId, l.anonymizedAt); // Risco 8: alimenta o hint de órfã
    n++;
  });
  if (n > 0) {
    invalidateStatsCache();
    markDirty();
  }
  return n;
}

// Poda silenciosa (auditoria): snapshot dos contadores de descarte por cap,
// consumido pelo /api/health e exibido na tela de Diagnóstico.
function getPruneStats() {
  return {
    leads: pruneStats.leads, events: pruneStats.events,
    leadsLastAt: pruneStats.leadsLastAt, eventsLastAt: pruneStats.eventsLastAt,
    maxLeads: MAX_LEADS, maxEvents: MAX_EVENTS
  };
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
  attachTracking, getLead, findLeadByEmail, findLeadByPhone, findLeadByTtclid, ingestLead, matchExternalConversion, getStats, reset, hydrate,
  inCheckoutNow, anonymizeOldLeads, markPaymentStarted, getPruneStats
  };
