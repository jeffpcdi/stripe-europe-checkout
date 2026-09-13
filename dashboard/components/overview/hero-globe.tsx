'use client'

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, ShoppingBag, MapPin, Globe2, ArrowUpRight, X } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData, presenceIncreases } from '@/lib/live-globe'
import { countryName } from '@/lib/countries'
import { countryFlag, fmtCurrency, timeAgo } from '@/lib/format'
import { GlobeBoundary } from '@/components/geo/globe-boundary'
import { OverviewMetrics, type OverviewMetricsProps } from '@/components/overview/overview-metrics'

interface LatestLeadInfo { code: string; name: string; flag: string; at: number }

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
  periodPicker: ReactNode
  onRefresh: () => void
  refreshing?: boolean
  purchasesStale?: boolean
}

/** Um painel, um canvas. Métricas e atividade não dependem do carregamento do WebGL. */
export function HeroGlobe({ focusCode, purchases = [], metrics, periodPicker, onRefresh, refreshing = false, purchasesStale = false }: HeroGlobeProps) {
  const { data, error, mutate, isLoading } = useLive()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(focusCode || null)
  const [focusRevision, setFocusRevision] = useState(0)
  const [pulseCodes, setPulseCodes] = useState<string[]>([])
  const [latestLead, setLatestLead] = useState<LatestLeadInfo | null>(null)
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

  // Primeira leitura/reconexão estabelece a base: somente aumento real gera pulso.
  useEffect(() => {
    const increased = live.fresh ? presenceIncreases(previous.current, live.countries) : []
    previous.current = live.fresh ? live.countries : null
    if (!live.fresh) { setLatestLead(null); setPulseCodes([]); return }
    if (!increased.length) return
    const code = increased[0]
    setPulseCodes(increased)
    setLatestLead({ code, name: countryName(code), flag: countryFlag(code), at: Date.now() })
  }, [live])

  useEffect(() => {
    if (!latestLead) return
    const pulseTimer = window.setTimeout(() => setPulseCodes([]), 4500)
    const bannerTimer = window.setTimeout(() => setLatestLead(null), 6000)
    return () => { window.clearTimeout(pulseTimer); window.clearTimeout(bannerTimer) }
  }, [latestLead])

  useEffect(() => {
    if (!focusCode) return
    setSelected(focusCode)
    setFocusRevision(value => value + 1)
  }, [focusCode])

  function focusCountry(code: string | null) {
    setSelected(code)
    setFocusRevision(value => value + 1)
  }

  return <section className="overview-observatory" aria-label="Visão geral da operação">
    <header className="observatory-header">
      <div className="observatory-period">{periodPicker}</div>
      <button type="button" className="observatory-refresh" onClick={() => { onRefresh(); void mutate() }} disabled={refreshing} aria-label={refreshing ? 'Atualizando indicadores' : 'Atualizar indicadores'} title="Atualizar indicadores">
        <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} aria-hidden="true" /><span>{refreshing ? 'Atualizando' : 'Atualizar'}</span>
      </button>
    </header>

    <OverviewMetrics {...metrics} globe={
      <GlobeBoundary embedded>
        <GlobePanel embedded countries={live.countries} online={live.online} focusCode={selected} focusRevision={focusRevision} pulseCodes={pulseCodes}>
          {selected && (
            <div className="observatory-globe-caption">
              <button type="button" onClick={() => focusCountry(null)} title="Limpar foco no país"><MapPin size={13} aria-hidden="true" />{countryName(selected)}<X size={13} aria-hidden="true" /></button>
            </div>
          )}
          <div className="observatory-fullscreen-countries" role="group" aria-label="Localizar país no globo ampliado">
            {live.countries.slice(0, 3).map(country => <button type="button" key={country.code} aria-pressed={selected === country.code} onClick={() => focusCountry(country.code)}><span aria-hidden="true">{countryFlag(country.code)}</span>{countryName(country.code)}<strong>{country.count}</strong></button>)}
          </div>
        </GlobePanel>
      </GlobeBoundary>
    } />

    <div className="observatory-activity" aria-label="Atividade atual, independente do período">
      <section className="observatory-live" aria-label="Visitantes ao vivo">
        <header className="observatory-activity-heading"><h3><span className="observatory-status-dot" data-fresh={live.fresh} aria-hidden="true" />Visitantes ao vivo</h3><span>{live.fresh ? 'agora' : isLoading ? 'carregando' : 'sem atualização'}</span></header>
        <div className="observatory-live-total"><strong>{live.online?.toLocaleString('pt-BR') ?? '—'}</strong><span>{live.online === 1 ? 'visitante online' : 'visitantes online'}</span></div>
        {live.fresh && data && <p className="observatory-live-time">Atualizado às <time dateTime={data.ts}>{new Date(data.ts).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time> · Brasília</p>}
        {!live.fresh && !isLoading && <button type="button" className="observatory-text-link" onClick={() => void mutate()}><RefreshCw size={13} aria-hidden="true" />Tentar novamente</button>}
        {latestLead && <div className="observatory-new-access" role="status"><span>{latestLead.flag} Novo acesso · {latestLead.name}</span><button type="button" onClick={() => focusCountry(latestLead.code)} aria-label={`Localizar novo acesso em ${latestLead.name}`}><MapPin size={14} aria-hidden="true" /></button></div>}
      </section>

      <section className="observatory-countries" aria-label="Top países ao vivo">
        <header className="observatory-activity-heading"><h3><MapPin size={15} aria-hidden="true" />Top países</h3><span>agora</span></header>
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
        <header className="observatory-activity-heading"><h3><ShoppingBag size={15} aria-hidden="true" />Compras recentes</h3><span>últimos 10 min</span><Link href="/activity" className="observatory-text-link" aria-label="Ver todas as compras no histórico">Ver todas <ArrowUpRight size={14} aria-hidden="true" /></Link></header>
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
