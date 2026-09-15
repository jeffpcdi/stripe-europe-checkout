'use client'

import type { ReactNode } from 'react'
import { BadgeDollarSign, Info, ShoppingCart, TrendingDown, TrendingUp } from 'lucide-react'
import { CountUp } from '@/components/count-up'
import type { AdsProfitabilityResponse, AdsRoasResponse } from '@/lib/types'
import type { PeriodMetrics } from '@/lib/metrics'
import { RevenueTrend } from '@/components/overview/revenue-trend'
import { ObservatoryIcon } from '@/components/overview/observatory-icon'

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
  profitability?: AdsProfitabilityResponse | null
  adsError?: boolean
  allPeriod?: boolean
  series?: PeriodMetrics['series']
}

const decimal = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const currencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const signedCurrencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency, signDisplay: 'always' }).format(value)
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

function Metric({ title, name, icon, value, children, description, monetary = false, tone }: {
  title: string
  name: string
  icon: ReactNode
  value: ReactNode
  children?: ReactNode
  description: ReactNode
  monetary?: boolean
  tone?: 'positive' | 'negative'
}) {
  return <article className={`observatory-metric observatory-metric--${name}`} aria-label={title} data-tone={tone}>
    <header className="observatory-metric-heading">
      <span className="observatory-metric-icon" aria-hidden="true">{icon}</span>
      <h3>{title}</h3>
      <MetricInfo title={title}>{description}</MetricInfo>
    </header>
    <div className="observatory-metric-value" data-sensitive={monetary || undefined}>{value}</div>
    {children ? <div className="observatory-metric-context">{children}</div> : null}
  </article>
}

/**
 * Dobra principal: dois rails de métricas alinhados ao globo. O período vem do
 * calendário global e os valores reagem imediatamente quando ele muda.
 */
export function OverviewMetrics({
  revenueCents,
  currency,
  sales,
  visits,
  purchased,
  approval,
  otherCurrencies,
  previousRevenueCents,
  ads,
  profitability,
  adsError,
  allPeriod,
  series = [],
  globe,
}: OverviewMetricsProps & { globe?: ReactNode }) {
  const money = currencyFormat(currency)
  const signedMoney = signedCurrencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || currency)
  const roas = hasAds && !ads?.currencyMismatch && validNumber(ads?.roas) ? ads.roas : null
  const cpa = hasAds && validNumber(ads?.cpa) ? ads.cpa : null

  // Conversão geral usa jornadas rastreadas: compras concluídas no período / visitas do período.
  // Sem visitas, exibe 0% em vez de um estado quebrado ou divisão inválida.
  const conversion = visits > 0 ? purchased / visits * 100 : 0
  const variation = previousRevenueCents !== null && previousRevenueCents > 0
    ? (revenueCents - previousRevenueCents) / previousRevenueCents * 100
    : null

  const mainCurrency = currency.toUpperCase()
  const profitCurrency = profitability?.currency?.toUpperCase()
  const spendCurrency = ads?.currency?.toUpperCase()
  const profitFromEngine = profitability && profitCurrency === mainCurrency ? profitability.netProfitCents : null
  const spendComparable = spend === null || spend === 0 || !spendCurrency || spendCurrency === mainCurrency
  const estimatedProfit = spendComparable ? revenueCents - Math.round((spend || 0) * 100) : null
  const profitCents = profitFromEngine ?? estimatedProfit
  const profitTone = profitCents == null ? undefined : profitCents < 0 ? 'negative' : 'positive'

  return <div className="observatory-metrics" role="group" aria-label="Indicadores do período e globo de presença">
    <div className="observatory-metric-rail observatory-metric-rail--left">
      <article className="observatory-metric observatory-metric--revenue" aria-label="Faturamento">
        <header className="observatory-metric-heading">
          <span className="observatory-metric-icon" aria-hidden="true"><ObservatoryIcon name="revenue" /></span>
          <h3>Faturamento</h3>
          <MetricInfo title="Faturamento">
            <p>Vendas aprovadas no período global, na moeda exibida.</p>
            {otherCurrencies > 0 ? <p>Vendas em outras moedas ficam fora deste total.</p> : null}
            <p>Ticket médio: <strong data-sensitive>{sales > 0 ? money(revenueCents / 100 / sales) : '—'}</strong>.</p>
          </MetricInfo>
        </header>
        <div className="observatory-metric-value" data-sensitive><CountUp value={revenueCents / 100} format={money} /></div>
        {(variation !== null || previousRevenueCents !== null) ? <div className="observatory-revenue-comparison">
          {variation !== null ? <span className="observatory-change" data-direction={variation < 0 ? 'down' : 'up'} aria-label={`${decimal(variation, 0)}% em relação ao período anterior`}>
            {variation < 0 ? <TrendingDown size={13} aria-hidden="true" /> : <TrendingUp size={13} aria-hidden="true" />}
            {variation > 0 ? '+' : ''}{decimal(variation, 0)}%
          </span> : null}
          {previousRevenueCents !== null ? <span>vs <span data-sensitive>{money(previousRevenueCents / 100)}</span></span> : null}
        </div> : null}
        <div className="observatory-revenue-trend"><RevenueTrend series={series} currency={currency} compact /></div>
        <div className="observatory-revenue-sales"><ShoppingCart size={14} aria-hidden="true" /><span><strong>{sales.toLocaleString('pt-BR')}</strong> {sales === 1 ? 'venda' : 'vendas'}</span></div>
      </article>

      <Metric
        title="Lucro"
        name="profit"
        icon={<BadgeDollarSign size={18} />}
        monetary
        tone={profitTone}
        value={profitCents == null ? '—' : <CountUp value={profitCents / 100} format={signedMoney} />}
        description={<>{profitability ? <p>Receita menos mídia, reembolsos, disputas e custos configurados.</p> : <p>Estimativa pela receita do período menos o investimento em anúncios disponível.</p>}{profitability ? <p>Margem: <strong>{decimal(profitability.netMarginPct)}%</strong>.</p> : null}</>}
      >
        {profitability ? <span>Margem <strong>{decimal(profitability.netMarginPct)}%</strong></span> : null}
      </Metric>
    </div>

    {globe ? <div className="observatory-globe">{globe}</div> : null}

    <div className="observatory-metric-rail observatory-metric-rail--right">
      <Metric
        title="Investimento"
        name="spend"
        icon={<ObservatoryIcon name="spend" />}
        monetary
        value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
        description={<><p>Investimento sincronizado da conta de anúncios no período global.</p>{ads?.lastSyncedAt ? <p>Última sincronização: <time dateTime={ads.lastSyncedAt}>{new Date(ads.lastSyncedAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}</time>.</p> : null}</>}
      >
        {adsError ? <span data-warning>Atualização pendente</span> : null}
      </Metric>

      <Metric
        title="Conversão"
        name="conversion"
        icon={<ObservatoryIcon name="conversion" />}
        value={<CountUp value={conversion} format={value => `${decimal(value)}%`} />}
        description={<><p>Compras rastreadas concluídas no período divididas pelas visitas do mesmo período.</p><p>Aprovação de pagamento: <strong>{visits > 0 ? `${decimal(approval, 0)}%` : '—'}</strong>.</p></>}
      >
        <span><strong>{purchased.toLocaleString('pt-BR')}</strong> compras · <strong>{visits.toLocaleString('pt-BR')}</strong> visitas</span>
      </Metric>

      <Metric
        title="ROAS"
        name="return"
        icon={<ObservatoryIcon name="return" />}
        value={roas !== null ? <CountUp value={roas} format={value => `${decimal(value, 2)}×`} /> : '—'}
        description={<><p>Receita atribuída por unidade investida.</p><p>Sem gasto no período, o indicador é exibido como 0,00×. Moedas incompatíveis continuam sem cálculo.</p>{allPeriod ? <p>Em Tudo, toda a dashboard usa a janela comparável de 365 dias.</p> : null}</>}
      >
        {ads?.currencyMismatch ? <span>Moedas diferentes</span> : cpa !== null ? <span>CPA <strong data-sensitive>{adsMoney(cpa)}</strong></span> : null}
      </Metric>
    </div>
  </div>
}
