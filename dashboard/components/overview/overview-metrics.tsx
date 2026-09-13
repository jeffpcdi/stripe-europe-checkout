'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, TrendingDown, TrendingUp, ChartNoAxesColumnIncreasing, Megaphone, Funnel, ShoppingCart, Info } from 'lucide-react'
import { CountUp } from '@/components/count-up'
import type { AdsRoasResponse } from '@/lib/types'
import type { PeriodMetrics } from '@/lib/metrics'
import { RevenueTrend } from '@/components/overview/revenue-trend'

export interface OverviewMetricsProps {
  revenueCents: number
  currency: string
  sales: number
  visits: number
  purchased: number
  approval: number
  otherCurrencies: number
  previousRevenueCents: number | null
  ads?: AdsRoasResponse | null
  adsError?: boolean
  allPeriod?: boolean
  series?: PeriodMetrics['series']
}

const decimal = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const currencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function MetricInfo({ title, children }: { title: string; children: ReactNode }) {
  return <details className="observatory-info" onKeyDown={event => {
    if (event.key !== 'Escape') return
    event.currentTarget.open = false
    event.currentTarget.querySelector('summary')?.focus()
  }} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false
  }}>
    <summary aria-label={`Como ler ${title}`} title={`Como ler ${title}`}><Info size={15} aria-hidden="true" /></summary>
    <div className="observatory-info-content">{children}</div>
  </details>
}

function Metric({ title, name, icon, value, children, description, monetary = false, action }: {
  title: string; name: string; icon: ReactNode; value: ReactNode; children: ReactNode
  description: ReactNode; monetary?: boolean; action?: ReactNode
}) {
  return <article className={`observatory-metric observatory-metric--${name}`} aria-label={title}>
    <header className="observatory-metric-heading">
      <span className="observatory-metric-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <MetricInfo title={title}>{description}</MetricInfo>
    </header>
    <div className="observatory-metric-value" data-sensitive={monetary || undefined}>{value}</div>
    <div className="observatory-metric-context">{children}</div>
    {action}
  </article>
}

/** As métricas são HTML independente do canvas; filtros não remontam o globo. */
export function OverviewMetrics({ revenueCents, currency, sales, visits, purchased, approval, otherCurrencies, previousRevenueCents, ads, adsError, allPeriod, series = [], globe }: OverviewMetricsProps & { globe?: ReactNode }) {
  const money = currencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || 'BRL')
  const roas = hasAds && !ads.currencyMismatch && validNumber(ads.roas) ? ads.roas : null
  const cpa = hasAds && validNumber(ads.cpa) ? ads.cpa : null
  const conversion = visits > 0 ? purchased / visits * 100 : null
  const variation = previousRevenueCents !== null && previousRevenueCents > 0 ? (revenueCents - previousRevenueCents) / previousRevenueCents * 100 : null
  const syncDate = ads?.lastSyncedAt ? new Date(ads.lastSyncedAt) : null

  return <div className="observatory-metrics" role="group" aria-label="Indicadores do período e globo de presença">
    <article className="observatory-metric observatory-metric--revenue" aria-label="Faturamento">
      <header className="observatory-metric-heading">
        <span className="observatory-metric-icon" aria-hidden="true"><ChartNoAxesColumnIncreasing size={20} /></span>
        <h3>Faturamento</h3>
        <MetricInfo title="Faturamento">
          <p>Vendas aprovadas no período, na moeda exibida. Não inclui valores de outras moedas.</p>
          {otherCurrencies > 0 && <p>Há vendas em mais {otherCurrencies} {otherCurrencies === 1 ? 'moeda' : 'moedas'}.</p>}
          {otherCurrencies === 0 && <p>Valor médio por venda: <strong data-sensitive>{sales > 0 ? money(revenueCents / 100 / sales) : '—'}</strong>.</p>}
        </MetricInfo>
      </header>
      <div className="observatory-metric-value" data-sensitive><CountUp value={revenueCents / 100} format={money} /></div>
      <div className="observatory-revenue-comparison">
        {variation !== null && <span className="observatory-change" data-direction={variation < 0 ? 'down' : 'up'} aria-label={`${decimal(variation, 0)}% em relação ao período anterior`}>
          {variation < 0 ? <TrendingDown size={13} aria-hidden="true" /> : <TrendingUp size={13} aria-hidden="true" />}
          {variation > 0 ? '+' : ''}{decimal(variation, 0)}%
        </span>}
        <span>{previousRevenueCents !== null
          ? <>vs. <span data-sensitive>{money(previousRevenueCents / 100)}</span> anterior</>
          : allPeriod ? 'Todo o período registrado' : 'Sem comparação na mesma moeda'}</span>
      </div>
      <div className="observatory-revenue-trend"><RevenueTrend series={series} currency={currency} compact /></div>
      <div className="observatory-revenue-sales"><ShoppingCart size={14} aria-hidden="true" /><span><strong>{sales.toLocaleString('pt-BR')}</strong> {sales === 1 ? 'venda aprovada' : 'vendas aprovadas'}{otherCurrencies > 0 && ` · ${otherCurrencies + 1} moedas`}</span></div>
    </article>

    <Metric title="Investimento em anúncios" name="spend" icon={<Megaphone size={19} />} monetary
      value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
      description={<><p>Total da conta de anúncios, incluindo campanhas pausadas e encerradas, na moeda e no fuso do TikTok.</p><p>{allPeriod ? 'Em Tudo, os anúncios cobrem os últimos 90 dias.' : 'Os dados dependem da sincronização do TikTok, não são presença ao vivo.'}</p>{syncDate && Number.isFinite(syncDate.getTime()) && <p>Última sincronização: <time dateTime={syncDate.toISOString()}>{syncDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</time> (Brasília).</p>}</>}
      action={<Link href="/ads/tiktok" className="observatory-text-link">Ver campanhas <ArrowUpRight size={14} aria-hidden="true" /></Link>}>
      <span data-warning={adsError || undefined}>{adsError ? 'Atualização pendente' : spend === null ? 'Dados indisponíveis' : allPeriod ? 'TikTok Ads · últimos 90 dias' : 'TikTok Ads · conta inteira'}</span>
    </Metric>

    <Metric title="Conversão geral" name="conversion" icon={<Funnel size={19} />}
      value={conversion !== null ? <CountUp value={conversion} format={value => `${decimal(value)}%`} /> : '—'}
      description={<><p>Visitantes que chegaram à compra aprovada no período.</p><p>Aprovação no checkout: <strong>{visits > 0 ? `${decimal(approval, 0)}%` : '—'}</strong>.</p></>}>
      <span><strong>{purchased.toLocaleString('pt-BR')}</strong> {purchased === 1 ? 'compra' : 'compras'} · <strong>{visits.toLocaleString('pt-BR')}</strong> {visits === 1 ? 'visita' : 'visitas'}</span>
    </Metric>

    <Metric title="Retorno (ROAS)" name="return" icon={<TrendingUp size={19} />}
      value={roas !== null ? <CountUp value={roas} format={value => `${decimal(value, 2)}×`} /> : '—'}
      description={<><p>Receita atribuída por unidade gasta em anúncios. Não representa lucro.</p><p>O retorno exige receita e investimento na mesma moeda.{allPeriod ? ' Em Tudo, considera os últimos 90 dias dos anúncios.' : ''}</p></>}>
      {(!hasAds || ads?.currencyMismatch || roas === null) && <span>{!hasAds ? 'Dados indisponíveis' : ads?.currencyMismatch ? 'Moedas diferentes' : 'Retorno indisponível'}</span>}
      {cpa !== null && <span>Custo por venda <strong data-sensitive>{adsMoney(cpa)}</strong></span>}
      {adsError && <span data-warning>Atualização pendente</span>}
    </Metric>

    {globe && <div className="observatory-globe">{globe}</div>}
  </div>
}
