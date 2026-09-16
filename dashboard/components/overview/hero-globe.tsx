'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Globe2, ArrowUpRight, X, RefreshCw } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData, presenceIncreases } from '@/lib/live-globe'
import { countryName } from '@/lib/countries'
import { countryFlag, fmtCurrency, timeAgo } from '@/lib/format'
import { GlobeBoundary } from '@/components/geo/globe-boundary'
import { OverviewMetrics, type OverviewMetricsProps } from '@/components/overview/overview-metrics'

export interface GlobePurchase {
  at: string
  country?: string
  amount?: number
  currency?: string
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <div className="observatory-globe-loading" role="status"><Globe2 size={32} aria-hidden="true" /><span>Preparando o globo…</span></div>,
})

interface HeroGlobeProps {
  focusCode?: string | null
  purchases?: GlobePurchase[]
  metrics: OverviewMetricsProps
  onRefresh: () => void | Promise<void>
  refreshing?: boolean
  purchasesStale?: boolean
}

/** Um painel, um canvas. Métricas e presença continuam úteis mesmo se o WebGL falhar. */
export function HeroGlobe({ focusCode, purchases = [], metrics, onRefresh, refreshing = false, purchasesStale = false }: HeroGlobeProps) {
  const { data, error, mutate, isLoading } = useLive()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(focusCode || null)
  const [focusRevision, setFocusRevision] = useState(0)
  const [pulseCodes, setPulseCodes] = useState<string[]>([])
  const previous = useRef<{ code: string; count: number }[] | null>(null)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const live = useMemo(() => liveGlobeData(data, now, !!error), [data, now, error])
  const recentPurchases = useMemo(() => {
    const windowStart = now - 10 * 60_000
    return purchases.filter(purchase => {
      const timestamp = Date.parse(purchase.at)
      return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= now + 5_000
    }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [purchases, now])
  const onlineTotal = live.countries.reduce((sum, country) => sum + country.count, 0)

  useEffect(() => {
    const increased = live.fresh ? presenceIncreases(previous.current, live.countries) : []
    previous.current = live.fresh ? live.countries : null
    if (!live.fresh) { setPulseCodes([]); return }
    if (!increased.length) return
    setPulseCodes(increased)
  }, [live])

  useEffect(() => {
    if (!pulseCodes.length) return
    const pulseTimer = window.setTimeout(() => setPulseCodes([]), 1700)
    return () => window.clearTimeout(pulseTimer)
  }, [pulseCodes])

  useEffect(() => {
    if (!focusCode) return
    setSelected(focusCode)
    setFocusRevision(value => value + 1)
  }, [focusCode])

  function focusCountry(code: string | null) {
    setSelected(code)
    setFocusRevision(value => value + 1)
  }

  async function refreshOverview() {
    await Promise.allSettled([
      Promise.resolve(onRefresh()),
      mutate(),
    ])
  }

  return <section className="overview-observatory overview-observatory--premium" aria-label="Visão geral da operação">
    <div className="observatory-environment" aria-hidden="true"><i /><i /></div>

    <OverviewMetrics {...metrics} globe={
      <>
        <div className="observatory-globe-live" aria-live="polite" aria-label={live.fresh ? `${live.online ?? 0} visitantes ao vivo` : 'Visitantes ao vivo sem atualização'}>
          <span className="observatory-status-dot" data-fresh={live.fresh} aria-hidden="true" />
          <strong>{live.online?.toLocaleString('pt-BR') ?? '—'}</strong>
          <span>{live.fresh ? 'ao vivo' : 'sem atualização'}</span>
          <button
            type="button"
            onClick={() => void refreshOverview()}
            disabled={refreshing || isLoading}
            aria-label="Atualizar indicadores"
            title="Atualizar indicadores"
          >
            <RefreshCw size={12} aria-hidden="true" className={refreshing ? 'animate-spin' : undefined} />
          </button>
        </div>
        <GlobeBoundary embedded>
          <GlobePanel embedded countries={live.countries} online={live.online} focusCode={selected} focusRevision={focusRevision} pulseCodes={pulseCodes}>
            {selected && (
              <div className="observatory-globe-caption">
                <button type="button" onClick={() => focusCountry(null)} title="Limpar foco no país">{countryName(selected)}<X size={12} aria-hidden="true" /></button>
              </div>
            )}
            <div className="observatory-fullscreen-countries" role="group" aria-label="Localizar país no globo ampliado">
              {live.countries.slice(0, 3).map(country => <button type="button" key={country.code} aria-pressed={selected === country.code} onClick={() => focusCountry(country.code)}><span aria-hidden="true">{countryFlag(country.code)}</span>{countryName(country.code)}<strong>{country.count}</strong></button>)}
            </div>
          </GlobePanel>
        </GlobeBoundary>
      </>
    } />

    <div className="observatory-activity" aria-label="Atividade atual, independente do período">
      <section className="observatory-countries" aria-label="Top países ao vivo">
        <header className="observatory-activity-heading"><h3>Top países</h3></header>
        {live.countries.length > 0 ? <div className="observatory-country-list">
          {live.countries.slice(0, 3).map(country => {
            const percentage = Math.round(country.count / Math.max(1, onlineTotal) * 100)
            return <button type="button" key={country.code} onClick={() => focusCountry(selected === country.code ? null : country.code)} aria-pressed={selected === country.code} data-pulse={pulseCodes.includes(country.code)} title={`Localizar ${countryName(country.code)} no globo`}>
              <span aria-hidden="true">{countryFlag(country.code)}</span><span className="observatory-country-name">{countryName(country.code)}</span>
              <span className="observatory-country-track" aria-hidden="true"><i style={{ width: `${percentage}%` }} /></span>
              <strong>{country.count}</strong>
            </button>
          })}
        </div> : <p className="observatory-empty">{isLoading ? 'Buscando visitantes…' : !live.fresh ? 'Presença não atualizada' : live.online ? 'Localização não informada' : 'Aguardando novos visitantes'}</p>}
      </section>

      <section className="observatory-purchases" aria-label="Compras recentes">
        <header className="observatory-activity-heading"><h3>Compras</h3><span>10 min</span><Link href="/activity" className="observatory-text-link" aria-label="Ver todas as compras no histórico">Ver tudo <ArrowUpRight size={13} aria-hidden="true" /></Link></header>
        {purchasesStale && <p className="observatory-empty" data-warning>Histórico não atualizado</p>}
        {recentPurchases.length > 0 ? <div className="observatory-purchase-list">
          {recentPurchases.slice(0, 3).map((purchase, index) => <div className="observatory-purchase" key={`${purchase.at}-${index}`}>
            <span className="observatory-purchase-country"><span aria-hidden="true">{purchase.country ? countryFlag(purchase.country) : '🌐'}</span><span>{purchase.country ? countryName(purchase.country) : 'Origem não informada'}</span></span>
            <strong data-sensitive>{typeof purchase.amount === 'number' && Number.isFinite(purchase.amount) && purchase.amount >= 0 ? fmtCurrency(purchase.amount, purchase.currency) : 'Compra'}</strong>
            <time dateTime={purchase.at}>{timeAgo(purchase.at)}</time>
          </div>)}
        </div> : !purchasesStale && <p className="observatory-empty">Nenhuma compra nos últimos 10 min</p>}
      </section>
    </div>
  </section>
}
