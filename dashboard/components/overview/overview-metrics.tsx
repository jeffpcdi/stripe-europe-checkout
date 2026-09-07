'use client'

import type { CSSProperties, ReactNode } from 'react'
import Link from 'next/link'
import { Banknote, Megaphone, ChartNoAxesCombined, Funnel, ArrowUpRight, type LucideIcon } from 'lucide-react'
import { CountUp } from '@/components/count-up'
import type { AdsRoasResponse } from '@/lib/types'

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
}

const decimal = (value: number, digits = 1) => value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const currencyFormat = (currency: string) => (value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value)
const validNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

function Metric({ title, description, icon: Icon, index, value, footer, badge, monetary = false }: {
  title: string; description: string; icon: LucideIcon; index: number; value: ReactNode; footer: ReactNode; badge?: ReactNode; monetary?: boolean
}) {
  return (
    <article className="overview-metric" style={{ '--metric-index': index } as CSSProperties} aria-label={title}>
      <div className="overview-metric-heading">
        <h2 title={description}>{title}</h2>
        <span className="overview-metric-icon" aria-hidden="true"><Icon size={21} strokeWidth={1.5} /></span>
      </div>
      <div className="overview-metric-main">
        <div className="overview-metric-value" data-sensitive={monetary || undefined}>{value}</div>
        {badge}
      </div>
      <div className="overview-metric-footer">{footer}</div>
    </article>
  )
}

export function OverviewMetrics({ revenueCents, currency, sales, visits, purchased, approval, otherCurrencies, previousRevenueCents, ads, adsError, allPeriod }: OverviewMetricsProps) {
  const money = currencyFormat(currency)
  const hasAds = ads?.scope === 'advertiser_all_campaigns'
  const spend = hasAds && validNumber(ads.spend) ? ads.spend : null
  const adsMoney = currencyFormat(ads?.currency || 'BRL')
  const roas = hasAds && !ads.currencyMismatch && validNumber(ads.roas) ? ads.roas : null
  const cpa = hasAds && validNumber(ads.cpa) ? ads.cpa : null
  const conversion = visits > 0 ? purchased / visits * 100 : null
  const variation = previousRevenueCents !== null && previousRevenueCents > 0 ? (revenueCents - previousRevenueCents) / previousRevenueCents * 100 : null
  return (
    <section className="overview-metrics" aria-label="Indicadores principais">
      <Metric title="Faturamento" description="Valor das vendas aprovadas no período." icon={Banknote} index={0} monetary
        value={<CountUp value={revenueCents / 100} format={money} />}
        badge={variation !== null && <span className="overview-metric-change" data-direction={variation < 0 ? 'down' : 'up'} title="Comparado ao período anterior na mesma moeda">{variation > 0 ? '+' : ''}{decimal(variation, 0)}%</span>}
        footer={<><span><strong>{sales.toLocaleString('pt-BR')}</strong> {sales === 1 ? 'venda' : 'vendas'}{otherCurrencies > 0 && ` · +${otherCurrencies} ${otherCurrencies === 1 ? 'moeda' : 'moedas'}`}</span><span>Valor médio <strong data-sensitive>{sales > 0 ? money(revenueCents / 100 / sales) : '—'}</strong></span></>} />
      <Metric title="Gasto em ADS" description="Investimento total da conta de anúncios, incluindo campanhas pausadas e encerradas." icon={Megaphone} index={1} monetary
        value={spend !== null ? <CountUp value={spend} format={adsMoney} /> : '—'}
        footer={<><span className={adsError ? 'text-warning' : undefined}>{adsError ? 'Atualização pendente' : spend === null ? 'Dados indisponíveis' : allPeriod ? 'TikTok Ads · últimos 90 dias' : 'TikTok Ads · todas as campanhas'}</span><Link href="/ads/tiktok">Ver campanhas <ArrowUpRight size={13} aria-hidden="true" /></Link></>} />
      <Metric title="Retorno (ROAS)" description="Receita atribuída por unidade gasta em anúncios. Não representa lucro." icon={ChartNoAxesCombined} index={2}
        value={roas !== null ? <CountUp value={roas} format={(value) => `${decimal(value, 2)}×`} /> : '—'}
        footer={<><span>Custo por venda <strong data-sensitive>{cpa !== null ? adsMoney(cpa) : '—'}</strong></span><span>{ads?.currencyMismatch ? 'Receita e gasto em moedas diferentes' : 'Receita atribuída aos anúncios'}</span></>} />
      <Metric title="Conversão geral" description="Visitantes que chegaram à compra aprovada no período." icon={Funnel} index={3}
        value={conversion !== null ? <CountUp value={conversion} format={(value) => `${decimal(value)}%`} /> : '—'}
        footer={<><span><strong>{purchased.toLocaleString('pt-BR')}</strong> compras · <strong>{visits.toLocaleString('pt-BR')}</strong> visitas</span><span>Aprovação no checkout <strong>{visits > 0 ? `${decimal(approval, 0)}%` : '—'}</strong></span></>} />
    </section>
  )
}
