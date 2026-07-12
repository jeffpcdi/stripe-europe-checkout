// Agregação client-side por período — espelha o comportamento da dashboard
// legada (aggregate/prevWindow em dashboard-view.js): filtra events/leads
// pelo intervalo e deriva os mesmos KPIs.

import type { StatsResponse, Period, StatsEvent, Lead } from './types'

export interface PeriodMetrics {
  rev: Record<string, number>
  mainCur: string
  sales: number
  failed: number
  refunds: number
  disputes: number
  /** Item 285: valor devolvido (reembolsos + disputas) por moeda, em centavos */
  refundRev: Record<string, number>
  approval: number
  visits: number
  reachedCheckout: number
  purchased: number
  overall: number
  avgTicket: number
  countries: { code: string; name: string; count: number; purchased: number }[]
  series: { day: string; revenue: number; sales: number; visits: number }[]
  byGateway: { name: string; checkout: number; purchased: number }[]
  /** Item 298: receita (na moeda principal) por gateway, para o donut */
  revByGateway: { name: string; revenue: number; sales: number }[]
  /** Item 286: ranking de campanhas (utm_campaign) por leads e conversões */
  topCampaigns: SourceRank[]
  /** Item 287: ranking de links rastreados (linkSlug) por conversão */
  topLinks: SourceRank[]
}

export interface SourceRank {
  name: string
  leads: number
  purchased: number
  /** conversão lead → compra em % (1 casa) */
  conv: number
}

export function periodStart(period: Period, now = new Date()): Date | null {
  if (period === 'all') return null
  const d = new Date(now)
  if (period === 'today') {
    d.setHours(0, 0, 0, 0)
    return d
  }
  const days = period === '7d' ? 7 : 30
  d.setDate(d.getDate() - days)
  return d
}

export function prevWindow(period: Period, now = new Date()) {
  const start = periodStart(period, now)
  if (!start) return null
  const span = now.getTime() - start.getTime()
  return {
    curFrom: start,
    curTo: now,
    prevFrom: new Date(start.getTime() - span),
    prevTo: start,
  }
}

function within(at: string, from: Date | null, to: Date | null) {
  const t = new Date(at).getTime()
  if (from && t < from.getTime()) return false
  if (to && t > to.getTime()) return false
  return true
}

export function aggregate(
  data: StatsResponse,
  from: Date | null,
  to: Date | null = null,
): PeriodMetrics {
  const events: StatsEvent[] = data.events.filter((e) => within(e.at, from, to))
  const leads: Lead[] = data.leads.filter(
    (l) => !l.orphan && within(l.at, from, to),
  )

  const rev: Record<string, number> = {}
  const refundRev: Record<string, number> = {}
  let sales = 0
  let failed = 0
  let refunds = 0
  let disputes = 0

  // Série diária para sparklines/gráfico.
  // Item 295 (bug): at.slice(0,10) cortava o dia em UTC — venda às 22h de
  // Brasília (01h UTC do dia seguinte) caía no dia errado do gráfico.
  // O corte diário agora é no fuso de Brasília ('en-CA' → YYYY-MM-DD).
  const dayMap = new Map<string, { revenue: number; sales: number; visits: number }>()
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const dayOf = (at: string) => {
    const t = new Date(at)
    return Number.isNaN(t.getTime()) ? at.slice(0, 10) : dayFmt.format(t)
  }
  const bump = (at: string, key: 'revenue' | 'sales' | 'visits', v: number) => {
    const d = dayOf(at)
    const cur = dayMap.get(d) ?? { revenue: 0, sales: 0, visits: 0 }
    cur[key] += v
    dayMap.set(d, cur)
  }

  // Item 298: receita por gateway (só vendas na moeda dominante — misturar
  // moedas num donut somaria valores incomparáveis)
  const revGwMap = new Map<string, { name: string; revenue: number; sales: number; cur: string }>()

  for (const e of events) {
    if (e.type === 'sale') {
      sales++
      const cur = (e.currency || 'BRL').toUpperCase()
      rev[cur] = (rev[cur] || 0) + (e.amount || 0)
      bump(e.at, 'revenue', e.amount || 0)
      bump(e.at, 'sales', 1)
      const gwName = e.gateway || 'outro'
      const g = revGwMap.get(gwName) ?? { name: gwName, revenue: 0, sales: 0, cur }
      if (g.cur === cur) {
        g.revenue += e.amount || 0
        g.sales++
        revGwMap.set(gwName, g)
      }
    } else if (e.type === 'failed') failed++
    else if (e.type === 'refund' || e.type === 'dispute') {
      if (e.type === 'refund') refunds++
      else disputes++
      // Item 285: dinheiro que saiu — alimenta a receita líquida estimada
      const cur = (e.currency || 'BRL').toUpperCase()
      refundRev[cur] = (refundRev[cur] || 0) + (e.amount || 0)
    }
  }

  const visits = leads.length
  const reachedCheckout = leads.filter(
    (l) => l.stage === 'checkout' || l.stage === 'purchased',
  ).length
  const purchased = leads.filter((l) => l.stage === 'purchased').length

  for (const l of leads) bump(l.at, 'visits', 1)

  const countryMap = new Map<
    string,
    { code: string; name: string; count: number; purchased: number }
  >()
  for (const l of leads) {
    if (!l.country) continue
    const c = countryMap.get(l.country) ?? {
      code: l.country,
      name: l.countryName || l.country,
      count: 0,
      purchased: 0,
    }
    c.count++
    if (l.stage === 'purchased') c.purchased++
    countryMap.set(l.country, c)
  }

  // Funil por gateway — mesma lógica do byGateway do stats.js, mas por período
  const gwMap = new Map<string, { name: string; checkout: number; purchased: number }>()
  for (const l of leads) {
    if (!l.gateway) continue
    if (l.stage !== 'checkout' && l.stage !== 'purchased') continue
    const g = gwMap.get(l.gateway) ?? { name: l.gateway, checkout: 0, purchased: 0 }
    g.checkout++
    if (l.stage === 'purchased') g.purchased++
    gwMap.set(l.gateway, g)
  }

  // Itens 286/287: rankings por origem — campanha (utm_campaign) e link
  // rastreado (linkSlug). Ordena por conversões e, em empate, por leads.
  function rankBy(key: (l: Lead) => string | null | undefined): SourceRank[] {
    const map = new Map<string, { name: string; leads: number; purchased: number }>()
    for (const l of leads) {
      const name = key(l)
      if (!name) continue
      const r = map.get(name) ?? { name, leads: 0, purchased: 0 }
      r.leads++
      if (l.stage === 'purchased') r.purchased++
      map.set(name, r)
    }
    return [...map.values()]
      .map((r) => ({ ...r, conv: r.leads ? +((r.purchased / r.leads) * 100).toFixed(1) : 0 }))
      .sort((a, b) => b.purchased - a.purchased || b.leads - a.leads)
      .slice(0, 5)
  }
  const topCampaigns = rankBy((l) => l.utm?.campaign)
  const topLinks = rankBy((l) => l.linkSlug)

  const attempts = sales + failed
  const mainCur =
    Object.entries(rev).sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'BRL'
  const totalRev = rev[mainCur] || 0

  const series = [...dayMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({ day, ...v }))

  return {
    rev,
    mainCur,
    sales,
    failed,
    refunds,
    disputes,
    refundRev,
    approval: attempts ? +((sales / attempts) * 100).toFixed(1) : 0,
    visits,
    reachedCheckout,
    purchased,
    overall: visits ? +((purchased / visits) * 100).toFixed(1) : 0,
    avgTicket: sales ? Math.round(totalRev / sales) : 0,
    countries: [...countryMap.values()].sort((a, b) => b.count - a.count),
    series,
    byGateway: [...gwMap.values()].sort((a, b) => b.checkout - a.checkout),
    revByGateway: [...revGwMap.values()]
      .filter((g) => g.cur === mainCur && g.revenue > 0)
      .map(({ name, revenue, sales: s }) => ({ name, revenue, sales: s }))
      .sort((a, b) => b.revenue - a.revenue),
    topCampaigns,
    topLinks,
  }
}

// Formata centavos como moeda — delega ao helper unificado (item 185).
export { fmtCurrency as money } from './format'

export function deltaPct(cur: number, prev: number): number | null {
  if (!prev) return null
  return +(((cur - prev) / prev) * 100).toFixed(1)
}
