'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RefreshCw, Radio } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData, presenceIncreases } from '@/lib/live-globe'
import { countryName } from '@/lib/countries'
import { countryFlag } from '@/lib/format'

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
  const previous = useRef<{ code: string; count: number }[] | null>(null)
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])
  const live = useMemo(() => liveGlobeData(data, now, !!error), [data, now, error])
  useEffect(() => {
    const increased = presenceIncreases(previous.current, live.countries)
    previous.current = live.fresh ? live.countries : null
    setPulseCodes(increased)
    if (!increased.length) return
    const timer = window.setTimeout(() => setPulseCodes([]), 3500)
    return () => window.clearTimeout(timer)
  }, [live])
  return (
    <div className="presence-panel">
      <GlobePanel countries={live.countries} focusCode={selected || focusCode} focusRevision={focusRevision} pulseCodes={pulseCodes}>
        <header className="presence-header">
          <div><h2><Radio size={16} aria-hidden="true" />Visitantes ao vivo</h2><p>Presença atual por país</p></div>
          <div className="presence-online" data-fresh={live.fresh}><span aria-hidden="true" /><strong>{live.online ?? '—'}</strong><span>online</span></div>
        </header>
        <div className="presence-footer">
          {live.countries.length > 0 ? <>
            <div className="presence-countries" aria-label="Países com visitantes online">
              {live.countries.slice(0, 3).map(country => <button type="button" key={country.code} onClick={() => { setSelected(country.code); setFocusRevision(value => value + 1) }} aria-pressed={selected === country.code} title={`Localizar ${countryName(country.code)} no globo`}><span aria-hidden="true">{countryFlag(country.code)}</span><span className="presence-country-name">{countryName(country.code)}</span><strong>{country.count}</strong></button>)}
              {live.countries.length > 3 && <span className="text-xs text-muted-foreground">+{live.countries.length - 3} países</span>}
            </div>
            <p>Localização aproximada</p>
          </> : <p role="status">{isLoading ? 'Buscando visitantes…' : !live.fresh ? 'Presença não atualizada' : (live.online || 0) > 0 ? 'Localização não informada' : 'Nenhum visitante online agora'}</p>}
          {!live.fresh && !isLoading && <button type="button" className="presence-retry" onClick={() => void mutate()}><RefreshCw size={13} />Tentar novamente</button>}
        </div>
      </GlobePanel>
    </div>
  )
}
