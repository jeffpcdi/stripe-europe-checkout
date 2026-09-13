'use strict';

// Diagnóstico enxuto da Visão Geral. Mantém a regra de negócio no backend
// para que web, mobile e futuros clientes leiam a mesma verdade sem tentar
// inferir prontidão a partir de zeros na interface.

const UTM_MACRO_RE = /__[A-Z0-9]+(?:_[A-Z0-9]+)*__/;

function validTime(value) {
  const time = Date.parse(value || '');
  return Number.isFinite(time) ? time : null;
}

function latest(values) {
  let best = null;
  for (const value of values) {
    const time = validTime(value);
    if (time != null && (best == null || time > best)) best = time;
  }
  return best == null ? null : new Date(best).toISOString();
}

function cleanHost(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    return new URL(raw.includes('://') ? raw : 'https://' + raw).hostname
      .replace(/^www\./, '')
      .slice(0, 100);
  } catch (_) {
    return raw.split('/')[0].replace(/^www\./, '').slice(0, 100);
  }
}

function campaignOf(lead) {
  const value = lead && lead.utm && lead.utm.campaign;
  if (!value || UTM_MACRO_RE.test(String(value))) return '';
  return String(value).trim();
}

function pct(part, total) {
  return total > 0 ? Math.round((part / total) * 100) : null;
}

function buildOverviewHealth(input) {
  input = input || {};
  const snapshot = input.snapshot || {};
  const events = Array.isArray(snapshot.events) ? snapshot.events : [];
  const leads = (Array.isArray(snapshot.leads) ? snapshot.leads : []).filter((lead) => lead && !lead.orphan);
  const orphanLeads = (Array.isArray(snapshot.leads) ? snapshot.leads : []).filter(
    (lead) => lead && lead.orphan && lead.stage === 'purchased'
  );
  const links = Array.isArray(input.links) ? input.links : [];
  const pixels = Array.isArray(input.pixels) ? input.pixels : [];
  const gateways = Array.isArray(input.gateways) ? input.gateways : [];

  const paymentEvents = events.filter((event) =>
    ['sale', 'failed', 'refund', 'dispute'].includes(String(event && event.type || ''))
  );
  const saleEvents = paymentEvents.filter((event) => event.type === 'sale');
  const trackedPurchases = leads.filter((lead) => lead.stage === 'purchased').length;
  const orphanPurchases = orphanLeads.length;
  const purchaseBase = Math.max(saleEvents.length, trackedPurchases + orphanPurchases);
  const attributedVisits = leads.filter((lead) => lead.linkSlug || campaignOf(lead)).length;
  const knownCountryVisits = leads.filter((lead) => lead.country).length;

  const hostMap = new Map();
  for (const lead of leads) {
    let sites = Array.isArray(lead.sites) ? lead.sites : [];
    if (!sites.length && lead.site) sites = [{ host: lead.site, hits: 1, lastAt: lead.lastSeen || lead.at }];
    for (const site of sites) {
      const host = cleanHost(site && site.host);
      if (!host) continue;
      const row = hostMap.get(host) || { host, visits: 0, lastAt: null, pixels: new Set() };
      row.visits += Math.max(1, Number(site && site.hits) || 1);
      row.lastAt = latest([row.lastAt, site && site.lastAt, lead.lastSeen, lead.at]);
      if (lead.pixelSlug) row.pixels.add(String(lead.pixelSlug));
      hostMap.set(host, row);
    }
  }

  const hosts = Array.from(hostMap.values())
    .map((row) => ({ ...row, pixels: Array.from(row.pixels).sort() }))
    .sort((a, b) => (validTime(b.lastAt) || 0) - (validTime(a.lastAt) || 0));
  const uncoveredHosts = hosts.filter((host) => host.pixels.length === 0);
  const activeLinks = links.filter((link) => link && link.ativo !== false && link.arquivado !== true);
  const activePixels = pixels.filter((pixel) => pixel && pixel.active !== false);
  const readyPixels = activePixels.filter((pixel) => pixel.pixelCode && pixel.accessToken);
  const incompletePixels = activePixels.filter((pixel) => !pixel.pixelCode || !pixel.accessToken);

  const actions = [];
  const addAction = (id, severity, title, detail, href) => actions.push({ id, severity, title, detail, href });
  if (activeLinks.length === 0) {
    addAction('link', 'critical', 'Crie um link rastreado', 'Sem um link ativo, visitas e campanhas não fecham a atribuição.', '/links');
  }
  if (readyPixels.length === 0) {
    addAction('pixel', 'critical', 'Conclua a configuração do pixel', 'Nenhum pixel ativo tem Pixel ID e Access Token prontos.', '/conversions?tab=pixels');
  } else if (incompletePixels.length > 0) {
    addAction(
      'pixel-incomplete', 'warning', 'Revise pixels incompletos',
      incompletePixels.length === 1
        ? '1 pixel ativo não consegue enviar eventos.'
        : incompletePixels.length + ' pixels ativos não conseguem enviar eventos.',
      '/conversions?tab=pixels'
    );
  }
  if (gateways.length === 0) {
    addAction('gateway', 'critical', 'Conecte um gateway', 'Vendas só são confirmadas por webhook do gateway.', '/conversions?tab=gateways');
  }
  if (orphanPurchases > 0) {
    addAction(
      'orphan',
      'warning',
      'Recupere vendas sem jornada',
      orphanPurchases === 1
        ? '1 venda chegou pelo gateway sem visita rastreada correspondente.'
        : orphanPurchases + ' vendas chegaram pelo gateway sem visita rastreada correspondente.',
      '/funnel?orphan=1'
    );
  }
  if (leads.length >= 10 && attributedVisits / leads.length < 0.5) {
    addAction(
      'attribution',
      'warning',
      'Melhore a identificação da origem',
      'Menos da metade das visitas traz campanha ou link rastreado.',
      '/links'
    );
  }
  if (uncoveredHosts.length > 0) {
    addAction(
      'hosts',
      'warning',
      'Cubra todas as hospedagens',
      uncoveredHosts.length === 1
        ? '1 domínio recebeu visitas sem um pixel identificado.'
        : uncoveredHosts.length + ' domínios receberam visitas sem um pixel identificado.',
      '/conversions?tab=pixels'
    );
  }

  const lastTrafficAt = latest(leads.flatMap((lead) => [lead.lastSeen, lead.at]));
  const lastPaymentAt = latest(paymentEvents.map((event) => event.at));
  const lastDataAt = latest([snapshot.updatedAt, lastTrafficAt, lastPaymentAt]);
  const critical = actions.filter((action) => action.severity === 'critical').length;
  const warnings = actions.filter((action) => action.severity === 'warning').length;

  // Cadastros não comprovam entrega: o guia separa configuração de atividade
  // real e nunca pede uma compra de teste ou libera campanhas automaticamente.
  const setupSteps = [
    { id: 'link', label: 'Link rastreado', configured: activeLinks.length > 0, href: '/links' },
    { id: 'pixel', label: 'Pixel de conversões', configured: readyPixels.length > 0, href: '/conversions?tab=pixels' },
    { id: 'gateway', label: 'Gateway cadastrado', configured: gateways.length > 0, href: '/conversions?tab=gateways' }
  ];
  const nextSetupStep = setupSteps.find((step) => !step.configured);
  const orderedActions = [...actions].sort((a, b) => Number(b.severity === 'critical') - Number(a.severity === 'critical'));

  return {
    ok: true,
    status: critical > 0 ? 'critical' : warnings > 0 ? 'warning' : 'healthy',
    freshness: {
      lastDataAt,
      lastTrafficAt,
      lastPaymentAt,
      pollSeconds: 12,
      timezone: 'America/Sao_Paulo'
    },
    setup: {
      links: { total: links.length, active: activeLinks.length },
      pixels: { total: pixels.length, active: activePixels.length, ready: readyPixels.length, incomplete: incompletePixels.length },
      gateways: {
        total: gateways.length,
        lastEventAt: latest(gateways.map((gateway) => gateway.lastEventAt))
      }
    },
    guide: {
      configured: setupSteps.filter((step) => step.configured).length,
      total: setupSteps.length,
      steps: setupSteps,
      nextAction: nextSetupStep
        ? orderedActions.find((action) => action.id === nextSetupStep.id)
        : orderedActions[0] || null
    },
    coverage: {
      purchases: {
        total: purchaseBase,
        tracked: Math.min(trackedPurchases, purchaseBase),
        orphan: orphanPurchases,
        rate: pct(Math.min(trackedPurchases, purchaseBase), purchaseBase)
      },
      attribution: { total: leads.length, identified: attributedVisits, rate: pct(attributedVisits, leads.length) },
      geography: { total: leads.length, identified: knownCountryVisits, rate: pct(knownCountryVisits, leads.length) },
      hosts: { total: hosts.length, uncovered: uncoveredHosts.length, items: hosts.slice(0, 12) }
    },
    actions: orderedActions.slice(0, 8)
  };
}

module.exports = { buildOverviewHealth, cleanHost, campaignOf };
