'use client'

import type { ReactNode } from 'react'
import { CountUp } from '@/components/count-up'
import type { AdsProfitabilityResponse, AdsRoasResponse } from '@/lib/types'
import type { PeriodMetrics } from '@/lib/metrics'

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

function Metric({ title, name, value, monetary = false, tone }: {
  title: string
  name: string
  value: ReactNode
  monetary?: boolean
  tone?: 'positive' | 'negative'
}) {
  return <article className={`observatory-metric observatory-metric--${name}`} aria-label={title} data-tone={tone}>
    <h3 className="observatory-metric-label">{title}</h3>
    <div className="observatory-metric-value" data-sensitive={monetary || undefined}>{value}</div>
  </article>
}

/**
 * Dobra principal: métricas essenciais em dois rails e globo central.
 * Sem cards, subtítulos ou elementos decorativos concorrendo com os dados.
 */
export function OverviewMetrics({
  revenueCents,
  currency,
  visits,
  purchased,
  ads,
  profitability,
  globe,
}: OverviewMetricsProps & { globe?: ReactNode }) {
  const money = currencyFormat(currency)
  const signedMoney = signedCurrencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || currency)
  const roas = hasAds && !ads?.currencyMismatch && validNumber(ads?.roas) ? ads.roas : null
  const conversion = visits > 0 ? purchased / visits * 100 : 0

  const mainCurrency = currency.toUpperCase()
  const profitCurrency = profitability?.currency?.toUpperCase()
  const spendCurrency = ads?.currency?.toUpperCase()
  const profitFromEngine = profitability && profitCurrency === mainCurrency ? profitability.netProfitCents : null
  const spendComparable = spend === null || spend === 0 || !spendCurrency || spendCurrency === mainCurrency
  const estimatedProfit = spendComparable ? revenueCents - Math.round((spend || 0) * 100) : null
  const profitCents = profitFromEngine ?? estimatedProfit
  const profitTone = profitCents == null ? undefined : profitCents < 0 ? 'negative' : 'positive'

  return <div className="observatory-metrics" role="group" aria-label="Indicadores principais e presença ao vivo">
    <div className="observatory-metric-rail observatory-metric-rail--left">
      <Metric
        title="Faturamento"
        name="revenue"
        monetary
        value={<CountUp value={revenueCents / 100} format={money} />}
      />
      <Metric
        title="Lucro"
        name="profit"
        monetary
        tone={profitTone}
        value={profitCents == null ? '—' : <CountUp value={profitCents / 100} format={signedMoney} />}
      />
    </div>

    {globe ? <div className="observatory-globe">{globe}</div> : null}

    <div className="observatory-metric-rail observatory-metric-rail--right">
      <Metric
        title="Investimento"
        name="spend"
        monetary
        value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
      />
      <Metric
        title="Conversão"
        name="conversion"
        value={<CountUp value={conversion} format={value => `${decimal(value)}%`} />}
      />
      <Metric
        title="ROAS"
        name="return"
        value={roas !== null ? <CountUp value={roas} format={value => `${decimal(value, 2)}×`} /> : '—'}
      />
    </div>
  </div>
}
