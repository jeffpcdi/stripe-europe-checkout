'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, ShoppingBag, MapPin } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData, presenceIncreases } from '@/lib/live-globe'
import { countryName } from '@/lib/countries'
import { countryFlag, fmtCurrency, timeAgo } from '@/lib/format'
import { GlobeBoundary } from '@/components/geo/globe-boundary'

interface LatestLeadInfo {
  code: string
  name: string
  flag: string
  at: number
}

export interface GlobePurchase {
  at: string
  country?: string
  amount?: number
  currency?: string
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <div className="presence-loading" role="status">Preparando o globo…</div>,
})

export function HeroGlobe({ focusCode, purchases = [] }: { focusCode?: string | null; purchases?: GlobePurchase[] }) {
  const { data, error, mutate, isLoading } = useLive()
  const [now, setNow] = useState(() => Date.now())
  const [selected, setSelected] = useState<string | null>(null)
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
    return purchases
      .filter((purchase) => {
        const timestamp = Date.parse(purchase.at)
        return Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= now + 5_000
      })
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
  }, [purchases, now])

  const onlineTotal = useMemo(
    () => live.countries.reduce((sum, country) => sum + country.count, 0),
    [live.countries],
  )
  const selectedCountryName = useMemo(
    () => (selected ? countryName(selected) : null),
    [selected],
  )

  // O polling não interrompe a duração do destaque nem move a câmera do usuário.
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

  return (
    <div className="presence-panel">
      <GlobeBoundary>
      <GlobePanel
        countries={live.countries}
        focusCode={selected || focusCode}
        focusRevision={focusRevision}
        pulseCodes={pulseCodes}
      >
        <aside className="presence-insights" aria-label="Resumo de visitantes ao vivo">
          <header className="presence-header">
            <div className="presence-title-row">
              <h2>Visitantes ao vivo</h2>
              <span className="presence-live-state" data-fresh={live.fresh}>
                <i aria-hidden="true" />
                {live.fresh ? 'ao vivo' : 'atualizando'}
              </span>
            </div>
          </header>

          <div className="presence-total-block">
            <strong>{live.online ?? '—'}</strong>
            <span>{live.online === 1 ? 'visitante agora' : 'visitantes agora'}</span>
          </div>

          <div className="presence-insight-section">
            <div className="presence-insight-heading">
              <span className="presence-insight-label">Top países</span>
              {live.countries.length > 0 && <span className="presence-insight-meta">agora</span>}
            </div>
            {live.countries.length > 0 ? (
              <div className="presence-countries presence-countries--list" aria-label="Países com visitantes online">
                {live.countries.slice(0, 3).map((country) => {
                  const isPulse = pulseCodes.includes(country.code)
                  const percentage = Math.round((country.count / Math.max(1, onlineTotal)) * 100)
                  return (
                    <button
                      type="button"
                      key={country.code}
                      onClick={() => {
                        setSelected(selected === country.code ? null : country.code)
                        setFocusRevision(value => value + 1)
                      }}
                      aria-pressed={selected === country.code}
                      data-pulse={isPulse}
                      title={`Localizar ${countryName(country.code)} no globo`}
                    >
                      <span className="presence-country-flag" aria-hidden="true">{countryFlag(country.code)}</span>
                      <span className="presence-country-name">{countryName(country.code)}</span>
                      <span className="presence-country-track" aria-hidden="true"><i style={{ width: `${Math.max(10, percentage)}%` }} /></span>
                      <span className="presence-country-percentage">{percentage}%</span>
                      <strong>{country.count}</strong>
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="presence-empty-copy" role="status">
                {isLoading ? 'Buscando visitantes…' : !live.fresh ? 'Presença não atualizada' : 'Aguardando novos visitantes…'}
              </p>
            )}
          </div>

          <div className="presence-purchases" aria-label="Compras recentes">
            <div className="presence-purchases-heading">
              <span><ShoppingBag size={14} aria-hidden="true" />Compras recentes</span>
              <strong>{recentPurchases.length}</strong>
            </div>
            {recentPurchases.length > 0 ? (
              <div className="presence-purchase-list">
                {recentPurchases.slice(0, 2).map((purchase, index) => (
                  <div className="presence-purchase-row" key={`${purchase.at}-${index}`}>
                    <span className="presence-purchase-country">
                      <span aria-hidden="true">{purchase.country ? countryFlag(purchase.country) : '🌐'}</span>
                      <span>{purchase.country ? countryName(purchase.country) : 'Origem não informada'}</span>
                    </span>
                    <span className="presence-purchase-value" data-sensitive>
                      {Number(purchase.amount) > 0 ? fmtCurrency(purchase.amount as number, purchase.currency) : 'Compra'}
                    </span>
                    <span className="presence-purchase-time">{timeAgo(purchase.at)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="presence-purchase-empty">Nenhuma compra nos últimos 10 min</span>
            )}
          </div>

          {!live.fresh && !isLoading && (
            <button type="button" className="presence-retry" onClick={() => void mutate()}>
              <RefreshCw size={13} />
              Tentar novamente
            </button>
          )}
        </aside>

        {selectedCountryName && <div className="presence-focus-label" role="status"><MapPin size={14} aria-hidden="true" />{selectedCountryName}</div>}

        {/* Banner curto aparece apenas quando um novo acesso é detectado. */}
        {latestLead && (
          <div className="presence-lead-banner animate-in fade-in slide-in-from-top-2 duration-300" role="status" aria-live="polite">
            <span className="presence-lead-banner-dot" aria-hidden="true" />
            <span className="presence-lead-banner-tag">Novo acesso</span>
            <div className="presence-lead-banner-text">
              <span className="presence-lead-banner-flag">{latestLead.flag}</span>
              <strong>{latestLead.name}</strong>
            </div>
            <button
              type="button"
              className="presence-lead-banner-btn"
              onClick={() => {
                setSelected(latestLead.code)
                setFocusRevision(v => v + 1)
              }}
              title="Localizar visitante no globo"
            >
              Localizar
            </button>
          </div>
        )}
      </GlobePanel>
      </GlobeBoundary>
    </div>
  )
}
