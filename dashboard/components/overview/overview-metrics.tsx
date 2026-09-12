'use client'

import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { ArrowUpRight, TrendingDown, TrendingUp, ChartNoAxesColumnIncreasing, Megaphone, Funnel, ShoppingCart } from 'lucide-react'
import { CountUp } from '@/components/count-up'
import type { AdsRoasResponse } from '@/lib/types'
import type { PeriodMetrics } from '@/lib/metrics'
import { RevenueTrend } from '@/components/overview/revenue-trend'

interface OverviewMetricsProps {
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
  periodPicker?: ReactNode
  series?: PeriodMetrics['series']
}

const decimal = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const currencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

interface MetricProps {
  title: string
  description: string
  index: number
  value: ReactNode
  footer: ReactNode
  icon: ReactNode
  action?: ReactNode
  monetary?: boolean
  theme?: 'green' | 'pink' | 'cyan' | 'amber' | 'violet'
}

function Metric({ title, description, index, value, footer, icon, action, monetary = false, theme = 'cyan' }: MetricProps) {
  return (
    <article
      className="overview-metric surface-card group cursor-default"
      data-theme={theme}
      style={{ '--metric-index': index } as CSSProperties}
      aria-label={title}
    >
      <div className="overview-metric-heading">
        <div className="overview-metric-label">
          <span className="overview-metric-icon" aria-hidden="true">{icon}</span>
          <h2 title={description}>{title}</h2>
        </div>
        {action}
      </div>
      <div className="overview-metric-main">
        <div className="overview-metric-value" data-sensitive={monetary || undefined}>{value}</div>
      </div>
      <div className="overview-metric-footer">{footer}</div>
    </article>
  )
}

export function OverviewMetrics({ revenueCents, currency, sales, visits, purchased, approval, otherCurrencies, previousRevenueCents, ads, adsError, allPeriod, periodPicker, series = [] }: OverviewMetricsProps) {
  const money = currencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || 'BRL')
  const roas = hasAds && !ads.currencyMismatch && validNumber(ads.roas) ? ads.roas : null
  const cpa = hasAds && validNumber(ads.cpa) ? ads.cpa : null
  const conversion = visits > 0 ? purchased / visits * 100 : null
  const variation = previousRevenueCents !== null && previousRevenueCents > 0 ? (revenueCents - previousRevenueCents) / previousRevenueCents * 100 : null
  return (
    <section className="overview-metrics overview-metrics--summary" aria-label="Indicadores principais">
      <article className="overview-revenue surface-card" aria-label="Faturamento">
        <header className="overview-revenue-heading">
          <h2 title="Valor das vendas aprovadas no período."><ChartNoAxesColumnIncreasing size={20} aria-hidden="true" />Faturamento</h2>
          {periodPicker}
        </header>

        <section className="overview-revenue-primary" aria-label="Resultado do período">
          <div className="overview-revenue-value-row">
            <div className="overview-revenue-value" data-sensitive>
              <CountUp value={revenueCents / 100} format={money} />
            </div>
            {variation !== null && (
              <span
                className="overview-revenue-change"
                data-direction={variation < 0 ? 'down' : 'up'}
                title="Comparado ao período anterior na mesma moeda"
              >
                {variation < 0 ? <TrendingDown size={12} aria-hidden="true" /> : <TrendingUp size={12} aria-hidden="true" />}
                {variation > 0 ? '+' : ''}{decimal(variation, 0)}%
              </span>
            )}
          </div>
          <p className="overview-revenue-comparison">
            {previousRevenueCents !== null
              ? <>vs. período anterior (<span data-sensitive>{money(previousRevenueCents / 100)}</span>)</>
              : allPeriod ? 'Todo o período registrado' : 'Sem comparação na mesma moeda'}
          </p>
        </section>

        <div className="overview-revenue-plot">
          <RevenueTrend series={series} currency={currency} />
        </div>

        <footer className="overview-revenue-footer">
          <span className="overview-revenue-sales">
            <ShoppingCart size={20} aria-hidden="true" />
            <strong>{sales.toLocaleString('pt-BR')}</strong> {sales === 1 ? 'venda' : 'vendas'}
            {otherCurrencies > 0 && ` · +${otherCurrencies} ${otherCurrencies === 1 ? 'moeda' : 'moedas'}`}
          </span>
          <span className="overview-revenue-average">Valor médio <strong data-sensitive>{sales > 0 ? money(revenueCents / 100 / sales) : '—'}</strong></span>
        </footer>
      </article>
      <div className="overview-summary-kpis">
        <Metric
          title="Gasto em ADS"
          description="Investimento total da conta de anúncios, incluindo campanhas pausadas e encerradas."
          index={1}
          theme="amber"
          icon={<Megaphone size={16} aria-hidden="true" />}
          monetary
          value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
          action={
            <Link href="/ads/tiktok" className="overview-metric-action" aria-label="Ver campanhas" title="Ver campanhas">
              <ArrowUpRight size={14} aria-hidden="true" />
              <span className="sr-only">Ver campanhas</span>
            </Link>
          }
          footer={
            <>
              <span className={adsError ? 'overview-metric-context text-warning font-medium' : 'overview-metric-context'}>
                {adsError ? 'Atualização pendente' : spend === null ? 'Dados indisponíveis' : allPeriod ? 'TikTok Ads · últimos 90 dias' : 'TikTok Ads · todas as campanhas'}
              </span>
            </>
          }
        />
        <Metric
          title="Retorno (ROAS)"
          description="Receita atribuída por unidade gasta em anúncios. Não representa lucro."
          index={2}
          theme="cyan"
          icon={<ChartNoAxesColumnIncreasing size={16} aria-hidden="true" />}
          value={roas !== null ? <CountUp value={roas} format={(value) => `${decimal(value, 2)}×`} /> : '—'}
          footer={
            <>
              <span className="overview-metric-context">{!hasAds ? 'Dados indisponíveis' : ads?.currencyMismatch ? 'Receita e gasto em moedas diferentes' : roas === null ? 'Retorno indisponível' : 'Receita atribuída aos anúncios'}</span>
              {cpa !== null && <span className="overview-metric-detail">Custo por venda <strong data-sensitive>{adsMoney(cpa)}</strong></span>}
            </>
          }
        />
        <Metric
          title="Conversão geral"
          description="Visitantes que chegaram à compra aprovada no período."
          index={3}
          theme="violet"
          icon={<Funnel size={16} aria-hidden="true" />}
          value={conversion !== null ? <CountUp value={conversion} format={(value) => `${decimal(value)}%`} /> : '—'}
          footer={
            <>
              <span className="overview-metric-context"><strong>{purchased.toLocaleString('pt-BR')}</strong> {purchased === 1 ? 'compra' : 'compras'} · <strong>{visits.toLocaleString('pt-BR')}</strong> {visits === 1 ? 'visita' : 'visitas'}</span>
              <span className="overview-metric-detail">Aprovação no checkout <strong>{visits > 0 ? `${decimal(approval, 0)}%` : '—'}</strong></span>
            </>
          }
        />
      </div>
    </section>
  )
}
