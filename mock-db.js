// ── Banco de dados Mock em memória / arquivo local ────────────────────────
// Usado automaticamente quando DATABASE_URL não está configurada ou aponta
// para um host inacessível (ex.: placeholder em ambiente de teste/preview).
// Se o Neon estiver acessível, db.js usa o Neon diretamente.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'mock-db.json');

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}

let data = {
  accounts: {},
  sessions: {},
  gateways: {},
  leads: {},
  events: [],
  configs: {},
  pixels: {},
  links: {},
  custom_domains: {},
  currencies: {},
  processed_orders: {},
  quarantine: [],
  notifications: [],
  audit: [],
  variants: {},
  live_sessions: {},
  pixel_events: []
};

let loaded = false;

function loadFromDisk() {
  if (loaded) return;
  loaded = true;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(FILE)) {
      const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (raw && typeof raw === 'object') {
        data = { ...data, ...raw };
      }
    }
  } catch (err) {
    console.warn('[mock-db] Falha ao carregar mock-db.json:', err.message);
  }

  // Se não há contas, cria admin e dev iniciais
  if (Object.keys(data.accounts).length === 0) {
    const adminId = 'acc_admin000000000000000000';
    data.accounts[adminId] = {
      id: adminId,
      email: 'contato.pcdigitalof@gmail.com',
      password_hash: hashPassword('admin123456'),
      name: 'Admin ROI-NADOS',
      role: 'admin',
      created_at: new Date().toISOString(),
      totp_secret: null,
      currency: 'BRL'
    };
    const legacyAdminId = 'acc_admin_legacy_local';
    data.accounts[legacyAdminId] = {
      id: legacyAdminId,
      email: 'admin@roi-nados.local',
      password_hash: hashPassword('admin123456'),
      name: 'Admin Local',
      role: 'admin',
      created_at: new Date().toISOString(),
      totp_secret: null,
      currency: 'BRL'
    };
    const devId = 'acc_dev0000000000000000000';
    data.accounts[devId] = {
      id: devId,
      email: 'dev@local.test',
      password_hash: hashPassword('devdevdev'),
      name: 'Dev',
      role: 'user',
      created_at: new Date().toISOString(),
      totp_secret: null,
      currency: 'BRL'
    };
    saveToDiskSync();
  }
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveToDiskSync();
  }, 1000);
}

function saveToDiskSync() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn('[mock-db] Falha ao salvar mock-db.json:', err.message);
  }
}

// Inicializa dados
loadFromDisk();

module.exports = {
  ping: async () => true,

  // ── Contas ─────────────────────────────────────────────────────────────
  createAccount: async (acc) => {
    loadFromDisk();
    if (!acc || !acc.id || !acc.email) return null;
    const emailLower = acc.email.toLowerCase();
    for (const a of Object.values(data.accounts)) {
      if (a.email.toLowerCase() === emailLower) return null;
    }
    const created = {
      id: acc.id,
      email: emailLower,
      password_hash: acc.passwordHash,
      name: acc.name || null,
      role: acc.role || 'user',
      created_at: new Date().toISOString(),
      totp_secret: null,
      currency: 'BRL'
    };
    data.accounts[acc.id] = created;
    scheduleSave();
    return {
      id: created.id,
      email: created.email,
      name: created.name,
      role: created.role,
      created_at: created.created_at
    };
  },

  getAccountByEmail: async (email) => {
    loadFromDisk();
    if (!email) return null;
    const emailLower = email.toLowerCase();
    for (const a of Object.values(data.accounts)) {
      if (a.email.toLowerCase() === emailLower) return { ...a };
    }
    return null;
  },

  getAccountById: async (id) => {
    loadFromDisk();
    if (!id || !data.accounts[id]) return null;
    return { ...data.accounts[id] };
  },

  countAccounts: async () => {
    loadFromDisk();
    return Object.keys(data.accounts).length;
  },

  getFirstAccountId: async () => {
    loadFromDisk();
    const list = Object.values(data.accounts);
    if (!list.length) return null;
    list.sort((a, b) => {
      if (a.role === 'admin' && b.role !== 'admin') return -1;
      if (b.role === 'admin' && a.role !== 'admin') return 1;
      return new Date(a.created_at) - new Date(b.created_at);
    });
    return list[0].id;
  },

  claimLegacyData: async (accountId) => {
    loadFromDisk();
    return true;
  },

  updateAccountName: async (id, name) => {
    loadFromDisk();
    if (!id || !data.accounts[id]) return false;
    data.accounts[id].name = name;
    scheduleSave();
    return true;
  },

  updateAccountPassword: async (id, passwordHash) => {
    loadFromDisk();
    if (!id || !data.accounts[id]) return false;
    data.accounts[id].password_hash = passwordHash;
    scheduleSave();
    return true;
  },

  setAccountTotp: async (id, secret) => {
    loadFromDisk();
    if (!id || !data.accounts[id]) return false;
    data.accounts[id].totp_secret = secret || null;
    scheduleSave();
    return true;
  },

  accountDataCounts: async (accountId) => {
    loadFromDisk();
    return {
      leads: Object.values(data.leads).filter((l) => l.account_id === accountId).length,
      events: data.events.filter((e) => e.account_id === accountId).length,
      gateways: Object.values(data.gateways).filter((g) => g.account_id === accountId).length,
      links: Object.values(data.links).filter((l) => l.account_id === accountId).length,
      pixels: Object.values(data.pixels).filter((p) => p.account_id === accountId).length,
      domains: Object.values(data.custom_domains).filter((d) => d.account_id === accountId).length
    };
  },

  deleteAccountCascade: async (accountId) => {
    loadFromDisk();
    delete data.accounts[accountId];
    for (const [t, s] of Object.entries(data.sessions)) {
      if (s.account_id === accountId) delete data.sessions[t];
    }
    scheduleSave();
    return true;
  },

  // ── Sessões de Auth ────────────────────────────────────────────────────
  createAuthSession: async (accountId, days = 30, meta = {}) => {
    loadFromDisk();
    if (!accountId) return null;
    const token = 'tok_' + crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + days * 86400000).toISOString();
    data.sessions[token] = {
      token,
      account_id: accountId,
      created_at: new Date().toISOString(),
      expires_at: expiresAt,
      meta
    };
    scheduleSave();
    return token;
  },

  getAuthSession: async (token) => {
    loadFromDisk();
    if (!token || !data.sessions[token]) return null;
    const sess = data.sessions[token];
    if (new Date(sess.expires_at) < new Date()) {
      delete data.sessions[token];
      scheduleSave();
      return null;
    }
    return { ...sess };
  },

  deleteAuthSession: async (token) => {
    loadFromDisk();
    if (token && data.sessions[token]) {
      delete data.sessions[token];
      scheduleSave();
    }
    return true;
  },

  deleteAuthSessionBySid: async (accountId, sid) => {
    loadFromDisk();
    for (const [t, s] of Object.entries(data.sessions)) {
      if (s.account_id === accountId && t.slice(0, 16) === sid) {
        delete data.sessions[t];
      }
    }
    scheduleSave();
    return true;
  },

  deleteOtherAuthSessions: async (accountId, currentToken) => {
    loadFromDisk();
    for (const [t, s] of Object.entries(data.sessions)) {
      if (s.account_id === accountId && t !== currentToken) {
        delete data.sessions[t];
      }
    }
    scheduleSave();
    return true;
  },

  touchAuthSession: async (token) => {
    loadFromDisk();
    if (token && data.sessions[token]) {
      data.sessions[token].expires_at = new Date(Date.now() + 30 * 86400000).toISOString();
      scheduleSave();
    }
    return true;
  },

  listAuthSessions: async (accountId) => {
    loadFromDisk();
    return Object.values(data.sessions).filter((s) => s.account_id === accountId);
  },

  pruneAuthSessions: async () => {
    loadFromDisk();
    const now = new Date();
    let removed = 0;
    for (const [t, s] of Object.entries(data.sessions)) {
      if (new Date(s.expires_at) < now) {
        delete data.sessions[t];
        removed++;
      }
    }
    if (removed) scheduleSave();
    return removed;
  },

  // ── Gateways ───────────────────────────────────────────────────────────
  upsertGateway: async (gw) => {
    loadFromDisk();
    if (!gw || !gw.id) return null;
    data.gateways[gw.id] = {
      ...gw,
      config: gw.config || {},
      created_at: data.gateways[gw.id]?.created_at || new Date().toISOString()
    };
    scheduleSave();
    return data.gateways[gw.id];
  },

  deleteGateway: async (accountId, id) => {
    loadFromDisk();
    if (data.gateways[id] && (!accountId || data.gateways[id].account_id === accountId)) {
      delete data.gateways[id];
      scheduleSave();
      return true;
    }
    return false;
  },

  loadGateways: async (accountId) => {
    loadFromDisk();
    return Object.values(data.gateways).filter((g) => !accountId || g.account_id === accountId);
  },

  getGatewayByToken: async (token) => {
    loadFromDisk();
    if (!token) return null;
    return Object.values(data.gateways).find((g) => g.webhook_token === token) || null;
  },

  touchGateway: async (token, status) => {
    loadFromDisk();
    const gw = Object.values(data.gateways).find((g) => g.webhook_token === token);
    if (gw) {
      gw.last_event_at = new Date().toISOString();
      gw.last_event_status = status || 'ok';
      scheduleSave();
    }
  },

  // ── Leads ──────────────────────────────────────────────────────────────
  upsertLead: async (lead) => {
    loadFromDisk();
    if (!lead || !lead.id) return null;
    data.leads[lead.id] = {
      ...lead,
      updated_at: new Date().toISOString()
    };
    scheduleSave();
    return data.leads[lead.id];
  },

  findLeadsByContact: async (accountId, contacts) => {
    loadFromDisk();
    return Object.values(data.leads).filter((l) => {
      if (accountId && l.account_id && l.account_id !== accountId) return false;
      const d = l.data || l;
      if (contacts.email && d.email && d.email.toLowerCase() === contacts.email.toLowerCase()) return true;
      if (contacts.phone && d.phone && d.phone.endsWith(contacts.phone.slice(-8))) return true;
      return false;
    });
  },

  anonymizeOldLeads: async (accountId, days) => {
    return 0;
  },

  // ── Eventos ────────────────────────────────────────────────────────────
  insertEvent: async (type, payload, accountId) => {
    loadFromDisk();
    const entry = {
      id: 'ev_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      type,
      at: new Date().toISOString(),
      data: payload || {},
      account_id: accountId || null
    };
    data.events.push(entry);
    if (data.events.length > 5000) data.events = data.events.slice(-5000);
    scheduleSave();
    return entry;
  },

  archiveOldEvents: async (accountId, days) => 0,
  aggregateDaily: async (days) => 0,
  readDaily: async (accountId, from, to) => [],

  // ── Configs ────────────────────────────────────────────────────────────
  saveConfig: async (accountId, key, val) => {
    loadFromDisk();
    const k = (accountId || 'default') + ':' + key;
    data.configs[k] = val;
    scheduleSave();
    return true;
  },

  loadConfig: async (accountId, key) => {
    loadFromDisk();
    const k = (accountId || 'default') + ':' + key;
    return data.configs[k] !== undefined ? data.configs[k] : null;
  },

  loadAllConfigs: async (accountId) => {
    loadFromDisk();
    const prefix = (accountId || 'default') + ':';
    const res = {};
    for (const [k, v] of Object.entries(data.configs)) {
      if (k.startsWith(prefix)) {
        res[k.slice(prefix.length)] = v;
      }
    }
    return res;
  },

  // ── Pixels ─────────────────────────────────────────────────────────────
  upsertPixel: async (accountId, slug, dataOrObj) => {
    loadFromDisk();
    if (!accountId) return false;
    if (typeof accountId === 'object') {
      const p = accountId;
      const k = (p.account_id || 'default') + ':' + (p.slug || p.token || p.id || p.pixel_code);
      data.pixels[k] = p;
      scheduleSave();
      return true;
    }
    const k = (accountId || 'default') + ':' + slug;
    data.pixels[k] = { account_id: accountId, slug, ...(dataOrObj || {}) };
    scheduleSave();
    return true;
  },

  deletePixel: async (accountId, slug) => {
    loadFromDisk();
    const k = (accountId || 'default') + ':' + slug;
    if (data.pixels[k]) {
      delete data.pixels[k];
      scheduleSave();
      return true;
    }
    return false;
  },

  loadPixels: async (accountId) => {
    loadFromDisk();
    const prefix = (accountId || 'default') + ':';
    return Object.entries(data.pixels)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  },

  getPixelByToken: async (token) => {
    loadFromDisk();
    return Object.values(data.pixels).find((p) => p.token === token || p.pixel_code === token) || null;
  },

  insertPixelEvent: async (entry) => {
    loadFromDisk();
    data.pixel_events.push(entry);
    if (data.pixel_events.length > 2000) data.pixel_events = data.pixel_events.slice(-2000);
    scheduleSave();
  },

  loadPixelEvents: async (accountId, limit = 50) => {
    loadFromDisk();
    return data.pixel_events
      .filter((e) => !accountId || e.account_id === accountId)
      .slice(-limit)
      .reverse();
  },

  prunePixelEvents: async (days) => 0,

  // ── Links ──────────────────────────────────────────────────────────────
  upsertLink: async (l) => {
    loadFromDisk();
    if (!l || !l.slug) return null;
    const k = (l.account_id || 'default') + ':' + l.slug;
    data.links[k] = l;
    scheduleSave();
    return l;
  },

  deleteLink: async (accountId, slug) => {
    loadFromDisk();
    const k = (accountId || 'default') + ':' + slug;
    if (data.links[k]) {
      delete data.links[k];
      scheduleSave();
      return true;
    }
    return false;
  },

  loadLinks: async (accountId) => {
    loadFromDisk();
    const prefix = (accountId || 'default') + ':';
    return Object.entries(data.links)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  },

  // ── Domínios Personalizados ────────────────────────────────────────────
  upsertCustomDomain: async (d) => {
    loadFromDisk();
    if (!d || !d.host) return null;
    const k = (d.account_id || 'default') + ':' + d.host;
    data.custom_domains[k] = d;
    scheduleSave();
    return d;
  },

  deleteCustomDomain: async (accountId, host) => {
    loadFromDisk();
    const k = (accountId || 'default') + ':' + host;
    if (data.custom_domains[k]) {
      delete data.custom_domains[k];
      scheduleSave();
      return true;
    }
    return false;
  },

  loadCustomDomains: async (accountId) => {
    loadFromDisk();
    const prefix = (accountId || 'default') + ':';
    return Object.entries(data.custom_domains)
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => v);
  },

  setAccountCurrency: async (accountId, cur) => {
    loadFromDisk();
    data.currencies[accountId] = cur;
    if (data.accounts[accountId]) data.accounts[accountId].currency = cur;
    scheduleSave();
    return true;
  },

  loadAccountCurrencies: async () => {
    loadFromDisk();
    return { ...data.currencies };
  },

  // ── Quarentena & Dedup de Pedidos ──────────────────────────────────────
  insertQuarantine: async (entry) => {
    loadFromDisk();
    data.quarantine.push(entry);
    scheduleSave();
  },

  listQuarantine: async (accountId, limit = 50) => {
    loadFromDisk();
    return data.quarantine.slice(-limit).reverse();
  },

  countQuarantine: async (accountId) => {
    loadFromDisk();
    return data.quarantine.length;
  },

  resolveQuarantine: async (id) => {
    loadFromDisk();
    const idx = data.quarantine.findIndex((q) => q.id === id);
    if (idx >= 0) {
      data.quarantine.splice(idx, 1);
      scheduleSave();
    }
    return true;
  },

  pruneQuarantine: async () => 0,

  markOrderProcessed: async (orderId, gateway) => {
    loadFromDisk();
    const k = `${gateway}:${orderId}`;
    if (data.processed_orders[k]) return false;
    data.processed_orders[k] = true;
    scheduleSave();
    return true;
  },

  pruneProcessedOrders: async () => 0,

  // ── Auditoria & Notificações ───────────────────────────────────────────
  insertAudit: async (entry) => {
    loadFromDisk();
    data.audit.push(entry);
    if (data.audit.length > 2000) data.audit = data.audit.slice(-2000);
    scheduleSave();
  },

  listAudit: async (accountId, limit = 50) => {
    loadFromDisk();
    return data.audit.slice(-limit).reverse();
  },

  insertNotification: async (accountId, entry) => {
    loadFromDisk();
    if (!entry && typeof accountId === 'object') {
      entry = accountId;
      accountId = entry.accountId || 'default';
    }
    if (!entry) return null;
    const now = Date.now();
    const dedupeKey = entry.dedupeKey || entry.dedupe_key;
    if (dedupeKey) {
      const exists = data.notifications.some(
        n => (n.accountId === accountId || n.account_id === accountId) &&
             (n.dedupeKey === dedupeKey || n.dedupe_key === dedupeKey) &&
             (now - (n.at || new Date(n.created_at || 0).getTime()) < 5 * 60 * 1000)
      );
      if (exists) return null;
    }
    const item = {
      ...entry,
      account_id: accountId,
      accountId: accountId,
      created_at: new Date().toISOString(),
      at: now,
    };
    data.notifications.unshift(item);
    if (data.notifications.length > 1000) data.notifications = data.notifications.slice(0, 1000);
    scheduleSave();
    return item.id || 'notif_' + now;
  },

  listNotifications: async (accountId, limit = 50) => {
    loadFromDisk();
    const filtered = data.notifications.filter(
      n => !accountId || n.accountId === accountId || n.account_id === accountId
    );
    return filtered.slice(0, limit);
  },

  // ── Sessões de Visita & Variantes ──────────────────────────────────────
  upsertSession: async (s) => {
    loadFromDisk();
    if (s && s.id) data.live_sessions[s.id] = s;
    scheduleSave();
  },

  upsertVariant: async (v) => {
    loadFromDisk();
    if (v && v.name) data.variants[v.name] = v;
    scheduleSave();
  },

  loadState: async (accountId) => {
    loadFromDisk();
    return {
      events: data.events.filter((e) => !accountId || e.account_id === accountId),
      leads: Object.values(data.leads).filter((l) => !accountId || l.account_id === accountId),
      variants: Object.values(data.variants),
      sessions: Object.values(data.live_sessions)
    };
  },

  reset: async (accountId) => {
    loadFromDisk();
    data.events = data.events.filter((e) => accountId && e.account_id !== accountId);
    for (const [k, l] of Object.entries(data.leads)) {
      if (!accountId || l.account_id === accountId) delete data.leads[k];
    }
    scheduleSave();
    return true;
  },

  pruneSessions: async (days) => 0
};
