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
  const facts = input.facts && typeof input.facts === 'object' ? input.facts : null;
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
  const leadsTotal = facts ? Number(facts.leads_total) || 0 : leads.length;
  const trackedPurchases = facts ? Number(facts.tracked_purchases) || 0 : leads.filter((lead) => lead.stage === 'purchased').length;
  const orphanPurchases = facts ? Number(facts.orphan_purchases) || 0 : orphanLeads.length;
  const saleEventCount = facts ? Number(facts.sale_events) || 0 : saleEvents.length;
  const purchaseBase = Math.max(saleEventCount, trackedPurchases + orphanPurchases);
  const attributedVisits = facts ? Number(facts.attributed_visits) || 0 : leads.filter((lead) => lead.linkSlug || campaignOf(lead)).length;
  const knownCountryVisits = facts ? Number(facts.country_visits) || 0 : leads.filter((lead) => lead.country).length;

  const hostMap = new Map();
  if (facts && Array.isArray(facts.hosts)) {
    for (const item of facts.hosts) {
      const host = cleanHost(item && item.host);
      if (!host) continue;
      const row = hostMap.get(host) || { host, visits: 0, lastAt: null, pixels: new Set() };
      row.visits += Math.max(1, Number(item && item.visits) || 1);
      row.lastAt = latest([row.lastAt, item && (item.last_at || item.lastAt)]);
      const sourcePixels = Array.isArray(item && item.pixels) ? item.pixels : [];
      sourcePixels.filter(Boolean).forEach((pixel) => row.pixels.add(String(pixel)));
      hostMap.set(host, row);
    }
  } else {
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
    addAction('gateway', 'critical', 'Conecte um checkout', 'Vendas só são confirmadas por webhook do checkout.', '/conversions?tab=gateways');
  } else {
    const gatewayEvents = gateways
      .filter((gateway) => gateway && gateway.lastEventAt)
      .sort((a, b) => (validTime(b.lastEventAt) || 0) - (validTime(a.lastEventAt) || 0));
    const latestGateway = gatewayEvents[0] || null;
    const latestStatus = String(latestGateway && latestGateway.lastEventStatus || '');
    const latestGatewayFailed = /erro|error|falh|inválid|invalid|rejeitad/i.test(latestStatus);
    const gatewayValidated = saleEventCount > 0 || gateways.some((gateway) => /^ok\b/i.test(String(gateway && gateway.lastEventStatus || '')));
    if (latestGatewayFailed) {
      addAction(
        'gateway-validation',
        'warning',
        'Revise o último webhook do checkout',
        'O checkout recebeu um evento com falha e precisa de diagnóstico.',
        '/conversions?tab=gateways'
      );
    } else if (!gatewayValidated) {
      addAction(
        'gateway-validation',
        'warning',
        'Valide o primeiro webhook do checkout',
        'O checkout está cadastrado, mas ainda não há uma confirmação real de pagamento processada com sucesso.',
        '/conversions?tab=gateways'
      );
    }
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
  if (leadsTotal >= 10 && attributedVisits / leadsTotal < 0.5) {
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

  const lastTrafficAt = facts ? latest([facts.last_traffic_at]) : latest(leads.flatMap((lead) => [lead.lastSeen, lead.at]));
  const lastPaymentAt = facts ? latest([facts.last_payment_at]) : latest(paymentEvents.map((event) => event.at));
  const lastDataAt = latest([snapshot.updatedAt, lastTrafficAt, lastPaymentAt]);
  const critical = actions.filter((action) => action.severity === 'critical').length;
  const warnings = actions.filter((action) => action.severity === 'warning').length;

  return {
    ok: true,
    status: critical > 0 ? 'critical' : warnings > 0 ? 'warning' : 'healthy',
    freshness: {
      lastDataAt,
      lastTrafficAt,
      lastPaymentAt,
      pollSeconds: 12,
      timezone: String(input.timeZone || 'America/Sao_Paulo')
    },
    setup: {
      links: { total: links.length, active: activeLinks.length },
      pixels: { total: pixels.length, active: activePixels.length, ready: readyPixels.length, incomplete: incompletePixels.length },
      gateways: (() => {
        const withEvents = gateways
          .filter((gateway) => gateway && gateway.lastEventAt)
          .sort((a, b) => (validTime(b.lastEventAt) || 0) - (validTime(a.lastEventAt) || 0));
        const latestGateway = withEvents[0] || null;
        return {
          total: gateways.length,
          lastEventAt: latestGateway ? latestGateway.lastEventAt : null,
          lastEventStatus: latestGateway ? String(latestGateway.lastEventStatus || '') : null,
          validated: saleEventCount > 0 || gateways.some((gateway) => /^ok\b/i.test(String(gateway && gateway.lastEventStatus || '')))
        };
      })()
    },
    coverage: {
      purchases: {
        total: purchaseBase,
        tracked: Math.min(trackedPurchases, purchaseBase),
        orphan: orphanPurchases,
        rate: pct(Math.min(trackedPurchases, purchaseBase), purchaseBase)
      },
      attribution: { total: leadsTotal, identified: attributedVisits, rate: pct(attributedVisits, leadsTotal) },
      geography: { total: leadsTotal, identified: knownCountryVisits, rate: pct(knownCountryVisits, leadsTotal) },
      hosts: { total: hosts.length, uncovered: uncoveredHosts.length, items: hosts.slice(0, 12) }
    },
    actions: actions.slice(0, 8)
  };
}

module.exports = { buildOverviewHealth, cleanHost, campaignOf };
