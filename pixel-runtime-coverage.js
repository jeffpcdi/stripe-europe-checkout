'use strict';

const DEFAULT_WINDOW_DAYS = 365;

function normalizeHost(value) {
  let host = String(value == null ? '' : value).trim().toLowerCase();
  host = host.replace(/^www\./, '').replace(/\.+$/, '');
  return host.slice(0, 253);
}

function normalizeHits(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.max(1, Math.floor(n));
}

function isoOrNull(value) {
  if (!value) return null;
  const text = String(value).trim();
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function newer(current, candidate) {
  const next = isoOrNull(candidate);
  if (!next) return current || null;
  const prev = isoOrNull(current);
  if (!prev || Date.parse(next) > Date.parse(prev)) return next;
  return prev;
}

function preferredDate(recency) {
  if (!recency) return null;
  return isoOrNull(recency.site)
    || isoOrNull(recency.lastSeen)
    || isoOrNull(recency.updated)
    || isoOrNull(recency.created)
    || null;
}

function coverageKey(pixelSlug, host) {
  return JSON.stringify([String(pixelSlug || ''), normalizeHost(host)]);
}

function coverageFromLeads(leads, options = {}) {
  const wantedPixel = options.pixelSlug ? String(options.pixelSlug) : null;
  const wantedHost = options.host ? normalizeHost(options.host) : null;
  const grouped = new Map();

  (Array.isArray(leads) ? leads : []).forEach((lead) => {
    if (!lead) return;
    const pixelSlug = String(lead.pixelSlug || '');
    if (!pixelSlug || (wantedPixel && pixelSlug !== wantedPixel)) return;
    const modern = Array.isArray(lead.sites) && lead.sites.length ? lead.sites : null;
    const sites = modern || (lead.site ? [{ host: lead.site, hits: 1, lastAt: lead.lastSeen || lead.at }] : []);
    sites.forEach((site) => {
      const host = normalizeHost(site && site.host);
      if (!host || (wantedHost && host !== wantedHost)) return;
      const key = coverageKey(pixelSlug, host);
      const current = grouped.get(key) || {
        pixelSlug,
        host,
        visits: 0,
        recency: { site: null, lastSeen: null, updated: null, created: null },
      };
      current.visits += normalizeHits(site && site.hits);
      current.recency.site = newer(current.recency.site, site && site.lastAt);
      current.recency.lastSeen = newer(current.recency.lastSeen, lead.lastSeen);
      current.recency.updated = newer(current.recency.updated, lead.updatedAt || lead.updated_at);
      current.recency.created = newer(current.recency.created, lead.createdAt || lead.created_at || lead.at);
      grouped.set(key, current);
    });
  });

  return Array.from(grouped.values()).map((row) => ({
    pixelSlug: row.pixelSlug,
    host: row.host,
    visits: row.visits,
    lastSeenAt: preferredDate(row.recency),
  }));
}

function normalizeDurableCoverage(rows) {
  const grouped = new Map();
  (Array.isArray(rows) ? rows : []).forEach((raw) => {
    if (!raw) return;
    const pixelSlug = String(raw.pixel_slug || raw.pixelSlug || '');
    const host = normalizeHost(raw.host);
    if (!pixelSlug || !host) return;
    const key = coverageKey(pixelSlug, host);
    const current = grouped.get(key) || {
      pixelSlug,
      host,
      visits: 0,
      recency: { site: null, lastSeen: null, updated: null, created: null },
    };
    current.visits += normalizeHits(raw.visits == null ? raw.hits : raw.visits);
    current.recency.site = newer(current.recency.site, raw.site_last_at || raw.siteLastAt);
    current.recency.lastSeen = newer(current.recency.lastSeen, raw.last_seen_at || raw.lastSeenAt);
    current.recency.updated = newer(current.recency.updated, raw.updated_at || raw.updatedAt);
    current.recency.created = newer(current.recency.created, raw.created_at || raw.createdAt);
    grouped.set(key, current);
  });
  return Array.from(grouped.values()).map((row) => ({
    pixelSlug: row.pixelSlug,
    host: row.host,
    visits: row.visits,
    lastSeenAt: preferredDate(row.recency),
  }));
}

function resolveRuntimeCoverage(durableResult, hotLeads, options = {}) {
  if (durableResult && durableResult.ok) {
    return {
      data: Array.isArray(durableResult.data) ? durableResult.data : [],
      runtimeSource: 'neon',
      runtimeCoverageComplete: true,
    };
  }
  return {
    data: coverageFromLeads(hotLeads, options),
    runtimeSource: 'hot-cache-fallback',
    runtimeCoverageComplete: false,
  };
}

function installationVerdict(staticInstalled, runtimeRow, runtimeCoverageComplete) {
  const runtimeSeen = !!(runtimeRow && Number(runtimeRow.visits) > 0);
  if (runtimeSeen) return { installed: true, runtimeState: 'seen' };
  if (staticInstalled) return { installed: true, runtimeState: runtimeCoverageComplete ? 'not_seen' : 'unknown' };
  if (runtimeCoverageComplete) return { installed: false, runtimeState: 'not_seen' };
  return { installed: null, runtimeState: 'unknown' };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  normalizeHost,
  normalizeHits,
  preferredDate,
  coverageFromLeads,
  normalizeDurableCoverage,
  resolveRuntimeCoverage,
  installationVerdict,
};
