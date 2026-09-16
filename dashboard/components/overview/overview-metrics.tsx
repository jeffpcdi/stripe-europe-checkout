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
const integer = (value: number) => value.toLocaleString('pt-BR')
const currencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const signedCurrencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency, signDisplay: 'always' }).format(value)
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function Metric({ title, name, value, context, monetary = false, tone }: {
  title: string
  name: string
  value: ReactNode
  context?: ReactNode
  monetary?: boolean
  tone?: 'positive' | 'negative'
}) {
  return <article className={`observatory-metric observatory-metric--${name}`} aria-label={title} data-tone={tone}>
    <h3 className="observatory-metric-label">{title}</h3>
    <div className="observatory-metric-value" data-sensitive={monetary || undefined}>{value}</div>
    {context ? <div className="observatory-metric-context">{context}</div> : null}
  </article>
}

/**
 * Dobra principal: métricas essenciais em dois rails e globo central.
 * O número continua dominante; o microcontexto explica a base do indicador sem
 * reintroduzir cards, ícones ou legendas concorrentes.
 */
export function OverviewMetrics({
  revenueCents,
  currency,
  sales,
  visits,
  purchased,
  previousRevenueCents,
  ads,
  profitability,
  adsError = false,
  allPeriod = false,
  globe,
}: OverviewMetricsProps & { globe?: ReactNode }) {
  const money = currencyFormat(currency)
  const signedMoney = signedCurrencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && !adsError && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || currency)
  const roas = hasAds && !adsError && !ads?.currencyMismatch && validNumber(ads?.roas) ? ads.roas : null
  const cpa = hasAds && !adsError && !ads?.currencyMismatch && validNumber(ads?.cpa) ? ads.cpa : null
  const conversion = visits > 0 ? purchased / visits * 100 : 0

  const mainCurrency = currency.toUpperCase()
  const profitCurrency = profitability?.currency?.toUpperCase()
  const profitCents = profitability && profitCurrency === mainCurrency && Number.isFinite(profitability.netProfitCents)
    ? profitability.netProfitCents
    : null
  const profitTone = profitCents == null ? undefined : profitCents < 0 ? 'negative' : 'positive'

  const revenueChange = !allPeriod && previousRevenueCents != null && previousRevenueCents > 0
    ? ((revenueCents - previousRevenueCents) / previousRevenueCents) * 100
    : null
  const revenueContext = [
    `${integer(sales)} ${sales === 1 ? 'venda' : 'vendas'}`,
    revenueChange == null ? null : `${revenueChange >= 0 ? '+' : ''}${decimal(revenueChange)}% vs. período anterior`,
  ].filter(Boolean).join(' · ')

  const profitContext = profitability && profitCurrency === mainCurrency && Number.isFinite(profitability.netMarginPct)
    ? `Margem ${decimal(profitability.netMarginPct)}%${profitability.quality === 'mixed' ? ' · cobertura parcial' : ''}`
    : 'Aguardando composição completa de custos'

  const spendContext = hasAds && !adsError
    ? `${integer(ads?.sales ?? 0)} ${(ads?.sales ?? 0) === 1 ? 'venda atribuída' : 'vendas atribuídas'}`
    : 'TikTok Ads indisponível no momento'

  const conversionContext = `${integer(purchased)} ${purchased === 1 ? 'compra' : 'compras'} · ${integer(visits)} ${visits === 1 ? 'visita' : 'visitas'}`
  const roasContext = cpa !== null ? `CPA ${adsMoney(cpa)}` : hasAds && !adsError ? 'CPA indisponível no período' : 'Aguardando dados de mídia'

  return <div className="observatory-metrics" role="group" aria-label="Indicadores principais e presença ao vivo">
    <div className="observatory-metric-rail observatory-metric-rail--left">
      <Metric
        title="Faturamento"
        name="revenue"
        monetary
        value={<CountUp value={revenueCents / 100} format={money} />}
        context={revenueContext}
      />
      <Metric
        title="Lucro"
        name="profit"
        monetary
        tone={profitTone}
        value={profitCents == null ? '—' : <CountUp value={profitCents / 100} format={signedMoney} />}
        context={profitContext}
      />
    </div>

    {globe ? <div className="observatory-globe">{globe}</div> : null}

    <div className="observatory-metric-rail observatory-metric-rail--right">
      <Metric
        title="Investimento"
        name="spend"
        monetary
        value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
        context={spendContext}
      />
      <Metric
        title="Conversão"
        name="conversion"
        value={<CountUp value={conversion} format={value => `${decimal(value)}%`} />}
        context={conversionContext}
      />
      <Metric
        title="ROAS"
        name="return"
        value={roas !== null ? <CountUp value={roas} format={value => `${decimal(value, 2)}×`} /> : '—'}
        context={roasContext}
      />
    </div>
  </div>
}
