'use strict';

const DEFAULT_WINDOW_DAYS = 365;

function normalizeHost(value) {
  let host = String(value == null ? '' : value).trim().toLowerCase();
  host = host.replace(/[.]+$/g, '');
  if (host.startsWith('www.')) host = host.slice(4);
  return host;
}

function normalizePixelSlug(value) {
  return String(value == null ? '' : value).trim();
}

function validIso(value) {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function normalizeHits(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.floor(n)) : 1;
}

function latestIso(current, candidate) {
  const next = validIso(candidate);
  if (!next) return current || null;
  const prev = validIso(current);
  if (!prev || Date.parse(next) > Date.parse(prev)) return next;
  return prev;
}

function emptyCandidates() {
  return { site: null, lastSeen: null, updated: null, created: null };
}

function addCandidates(target, values) {
  target.site = latestIso(target.site, values.site);
  target.lastSeen = latestIso(target.lastSeen, values.lastSeen);
  target.updated = latestIso(target.updated, values.updated);
  target.created = latestIso(target.created, values.created);
}

function preferredDate(candidates) {
  return validIso(candidates.site)
    || validIso(candidates.lastSeen)
    || validIso(candidates.updated)
    || validIso(candidates.created)
    || null;
}

function aggregateHotCache(leads, options = {}) {
  const pixelFilter = normalizePixelSlug(options.pixelSlug);
  const hostFilter = normalizeHost(options.host);
  const pixels = new Map();

  for (const lead of Array.isArray(leads) ? leads : []) {
    if (!lead || typeof lead !== 'object') continue;
    const pixelSlug = normalizePixelSlug(lead.pixelSlug);
    if (!pixelSlug || (pixelFilter && pixelSlug !== pixelFilter)) continue;

    const modernSites = Array.isArray(lead.sites) && lead.sites.length ? lead.sites : null;
    const sites = modernSites || (normalizeHost(lead.site)
      ? [{ host: lead.site, lastAt: null, hits: 1 }]
      : []);

    let pixel = pixels.get(pixelSlug);
    if (!pixel) {
      pixel = { pixelSlug, visits: 0, candidates: emptyCandidates(), domains: new Map() };
      pixels.set(pixelSlug, pixel);
    }

    for (const site of sites) {
      const host = normalizeHost(site && site.host);
      if (!host || (hostFilter && host !== hostFilter)) continue;

      const hits = normalizeHits(site && site.hits);
      let domain = pixel.domains.get(host);
      if (!domain) {
        domain = { host, hits: 0, candidates: emptyCandidates() };
        pixel.domains.set(host, domain);
      }
      domain.hits += hits;
      pixel.visits += hits;

      const candidates = {
        site: site && site.lastAt,
        lastSeen: lead.lastSeen,
        updated: lead.updatedAt || lead.updated_at,
        created: lead.createdAt || lead.created_at || lead.at,
      };
      addCandidates(domain.candidates, candidates);
      addCandidates(pixel.candidates, candidates);
    }
  }

  return Array.from(pixels.values())
    .filter((pixel) => pixel.domains.size > 0)
    .map((pixel) => ({
      pixelSlug: pixel.pixelSlug,
      lastBrowserAt: preferredDate(pixel.candidates),
      visits: pixel.visits,
      domains: Array.from(pixel.domains.values())
        .map((domain) => ({
          host: domain.host,
          hits: domain.hits,
          lastAt: preferredDate(domain.candidates),
        }))
        .sort((a, b) => Date.parse(b.lastAt || '') - Date.parse(a.lastAt || '') || a.host.localeCompare(b.host)),
    }))
    .sort((a, b) => a.pixelSlug.localeCompare(b.pixelSlug));
}

function normalizeDurableCoverage(rows) {
  const pixels = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const pixelSlug = normalizePixelSlug(row && (row.pixelSlug || row.pixel_slug));
    const host = normalizeHost(row && row.host);
    if (!pixelSlug || !host) continue;

    const hits = normalizeHits(row && (row.hits == null ? row.visits : row.hits));
    let pixel = pixels.get(pixelSlug);
    if (!pixel) {
      pixel = { pixelSlug, visits: 0, candidates: emptyCandidates(), domains: new Map() };
      pixels.set(pixelSlug, pixel);
    }
    let domain = pixel.domains.get(host);
    if (!domain) {
      domain = { host, hits: 0, candidates: emptyCandidates() };
      pixel.domains.set(host, domain);
    }
    domain.hits += hits;
    pixel.visits += hits;

    const candidates = {
      site: row && (row.lastAt || row.last_at),
      lastSeen: row && (row.lastSeenAt || row.last_seen_at),
      updated: row && (row.updatedAt || row.updated_at),
      created: row && (row.createdAt || row.created_at),
    };
    addCandidates(domain.candidates, candidates);
    addCandidates(pixel.candidates, candidates);
  }

  return Array.from(pixels.values()).map((pixel) => ({
    pixelSlug: pixel.pixelSlug,
    lastBrowserAt: preferredDate(pixel.candidates),
    visits: pixel.visits,
    domains: Array.from(pixel.domains.values())
      .map((domain) => ({
        host: domain.host,
        hits: domain.hits,
        lastAt: preferredDate(domain.candidates),
      }))
      .sort((a, b) => Date.parse(b.lastAt || '') - Date.parse(a.lastAt || '') || a.host.localeCompare(b.host)),
  })).sort((a, b) => a.pixelSlug.localeCompare(b.pixelSlug));
}

function installationVerdict(staticInstalled, runtime, runtimeCoverageComplete) {
  const runtimeSeen = !!(runtime && Number(runtime.visits) > 0);
  const runtimeState = runtimeSeen
    ? 'seen'
    : (runtimeCoverageComplete ? 'not_seen' : 'unknown');
  return {
    runtimeSeen,
    runtimeState,
    instalado: staticInstalled || runtimeSeen
      ? true
      : (runtimeCoverageComplete ? false : null),
  };
}

function resolveRuntimeCoverage(durableResult, hotLeads, options = {}) {
  if (durableResult && durableResult.ok === true) {
    return {
      data: Array.isArray(durableResult.data) ? durableResult.data : [],
      runtimeSource: 'neon',
      runtimeCoverageComplete: true,
    };
  }
  return {
    data: aggregateHotCache(hotLeads, options),
    runtimeSource: 'hot-cache-fallback',
    runtimeCoverageComplete: false,
  };
}

module.exports = {
  DEFAULT_WINDOW_DAYS,
  normalizeHost,
  normalizeHits,
  validIso,
  aggregateHotCache,
  normalizeDurableCoverage,
  installationVerdict,
  resolveRuntimeCoverage,
};
