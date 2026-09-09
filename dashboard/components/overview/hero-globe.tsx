'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Radio } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData, presenceIncreases } from '@/lib/live-globe'
import { countryName } from '@/lib/countries'
import { countryFlag } from '@/lib/format'
import { GlobeBoundary } from '@/components/geo/globe-boundary'

interface LatestLeadInfo {
  code: string
  name: string
  flag: string
  at: number
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <div className="presence-loading" role="status">Preparando o globo…</div>,
})

export function HeroGlobe({ focusCode }: { focusCode?: string | null }) {
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
        <header className="presence-header">
          <div>
            <h2><Radio size={16} aria-hidden="true" />Visitantes ao vivo</h2>
          </div>
          <div className="presence-online" data-fresh={live.fresh}>
            <span aria-hidden="true" />
            <strong>{live.online ?? '—'}</strong>
            <span>online</span>
          </div>
        </header>

        {/* Banner animado flutuante quando um novo lead entra */}
        {latestLead && (
          <div className="presence-lead-banner animate-in fade-in slide-in-from-top-2 duration-300" role="status" aria-live="polite">
            <div className="presence-lead-banner-glow" aria-hidden="true" />
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

        <div className="presence-footer">
          {live.countries.length > 0 ? (
            <>
              <div className="presence-countries" aria-label="Países com visitantes online">
                {live.countries.slice(0, 5).map(country => {
                  const isPulse = pulseCodes.includes(country.code)
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
                      <span aria-hidden="true">{countryFlag(country.code)}</span>
                      <span className="presence-country-name">{countryName(country.code)}</span>
                      <strong>{country.count}</strong>
                      {isPulse && (
                        <span className="presence-country-pill-badge" aria-label="Novo acesso agora">Novo</span>
                      )}
                    </button>
                  )
                })}
                {live.countries.length > 5 && (
                  <span className="text-xs text-muted-foreground">+{live.countries.length - 5} países</span>
                )}
              </div>
              <p>Localização aproximada</p>
            </>
          ) : (
            <p role="status">
              {isLoading
                ? 'Buscando visitantes…'
                : !live.fresh
                ? 'Presença não atualizada'
                : (live.online || 0) > 0
                ? 'Localização não informada'
                : 'Nenhum visitante online agora'}
            </p>
          )}
          {!live.fresh && !isLoading && (
            <button type="button" className="presence-retry" onClick={() => void mutate()}>
              <RefreshCw size={13} />
              Tentar novamente
            </button>
          )}
        </div>
      </GlobePanel>
      </GlobeBoundary>
    </div>
  )
}
