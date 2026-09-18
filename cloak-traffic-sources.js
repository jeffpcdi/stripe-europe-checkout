'use strict';

const INTERNAL_QUERY_KEYS = new Set([
  'rk',
  'roi_test',
  'roi_debug',
  'roi_challenge',
  'roi_campaign',
]);

const SOURCES = Object.freeze({
  tiktok_standard: Object.freeze({
    id: 'tiktok_standard',
    label: 'TikTok Standard',
    params: Object.freeze([
      ['utm_source', 'tiktok'],
      ['utm_medium', 'paid_social'],
      ['utm_campaign', '__CAMPAIGN_NAME__'],
      ['campaign_id', '__CAMPAIGN_ID__'],
      ['adgroup_id', '__AID__'],
      ['adgroup_name', '__AID_NAME__'],
      ['creative_id', '__CID__'],
      ['creative_name', '__CID_NAME__'],
      ['placement', '__PLACEMENT__'],
    ]),
  }),
  tiktok_smart_plus: Object.freeze({
    id: 'tiktok_smart_plus',
    label: 'TikTok Smart+',
    params: Object.freeze([
      ['utm_source', 'tiktok'],
      ['utm_medium', 'paid_social'],
      ['utm_campaign', '__CAMPAIGN_NAME__'],
      ['campaign_id', '__CAMPAIGN_ID__'],
      ['adgroup_id', '__AID__'],
      ['adgroup_name', '__AID_NAME__'],
      ['ad_id', '__ADID_V2__'],
      ['ad_name', '__ADID_V2_NAME__'],
      ['creative_id', '__CID__'],
      ['creative_name', '__CID_NAME__'],
      ['placement', '__PLACEMENT__'],
    ]),
  }),
  custom: Object.freeze({
    id: 'custom',
    label: 'Personalizada',
    params: Object.freeze([]),
  }),
});

function normalizeTrafficSource(value) {
  const id = String(value || '').trim().toLowerCase();
  return SOURCES[id] ? id : 'tiktok_standard';
}

function encodePair(key, value) {
  return encodeURIComponent(String(key)) + '=' + encodeURIComponent(String(value));
}

function buildUrlParams(campaign, options = {}) {
  const source = SOURCES[normalizeTrafficSource(campaign && campaign.trafficSource)];
  const rows = [];

  if (campaign && campaign.trafficToken && options.includeTrafficToken !== false) {
    rows.push(['rk', String(campaign.trafficToken)]);
  }

  for (const [key, value] of source.params) rows.push([key, value]);

  if (source.id === 'custom' && Array.isArray(options.customParams)) {
    for (const pair of options.customParams.slice(0, 30)) {
      if (!Array.isArray(pair) || pair.length < 2) continue;
      const key = String(pair[0] || '').trim().slice(0, 80);
      const value = String(pair[1] || '').trim().slice(0, 300);
      if (key && value) rows.push([key, value]);
    }
  }

  return rows.map(([key, value]) => encodePair(key, value)).join('&');
}

function buildLinkKit(campaign, options = {}) {
  if (!campaign || !campaign.domainHost || !campaign.path) return null;
  const source = normalizeTrafficSource(campaign.trafficSource);
  const url = 'https://' + campaign.domainHost + '/' + campaign.path;
  const urlParams = buildUrlParams(campaign, options);
  return {
    trafficSource: source,
    trafficSourceLabel: SOURCES[source].label,
    url,
    urlParams,
    combinedUrl: urlParams ? url + '?' + urlParams : url,
  };
}

function stripInternalParams(input) {
  const source = input instanceof URLSearchParams
    ? new URLSearchParams(input.toString())
    : new URLSearchParams(String(input || ''));
  for (const key of Array.from(source.keys())) {
    const lowered = String(key).toLowerCase();
    if (INTERNAL_QUERY_KEYS.has(lowered) || lowered.startsWith('roi_')) source.delete(key);
  }
  return source;
}

module.exports = {
  SOURCES,
  INTERNAL_QUERY_KEYS,
  normalizeTrafficSource,
  buildUrlParams,
  buildLinkKit,
  stripInternalParams,
};
