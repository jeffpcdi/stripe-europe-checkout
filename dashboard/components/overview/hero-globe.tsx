'use client'

import dynamic from 'next/dynamic'
import { useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useLive } from '@/lib/api'
import { liveGlobeData } from '@/lib/live-globe'

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <div className="absolute inset-0 flex items-center justify-center" role="status"><span className="skeleton size-48 rounded-full" /><span className="sr-only">Carregando globo</span></div>,
})

export function HeroGlobe({ focusCode }: { focusCode?: string | null }) {
  const { data, error, mutate, isLoading } = useLive()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000)
    return () => window.clearInterval(timer)
  }, [])
  const live = useMemo(() => liveGlobeData(data, now, !!error), [data, now, error])
  return (
    <div className="hero-globe-container absolute inset-0 overflow-hidden" aria-label="Visitantes online por país">
      <div className="hero-globe-glow-soft" aria-hidden="true" />
      <GlobePanel countries={live.countries} focusCode={focusCode} metric="live" showArcs={false}
        emptyNote={<span className="rounded-full border border-border bg-background/90 px-3 py-1.5 text-xs text-muted-foreground">{isLoading ? 'Buscando visitantes…' : !live.fresh ? 'Presença não atualizada' : live.online && live.online > 0 ? 'Localização não informada' : 'Nenhum visitante online agora'}</span>} />
      <div className="pointer-events-none absolute left-4 top-4 z-20 max-w-[calc(100%-5rem)]">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-background/90 px-3 py-2 backdrop-blur-md">
          <span className={`size-2 rounded-full ${live.fresh ? 'bg-primary' : 'bg-warning'}`} aria-hidden="true" />
          <strong className="text-lg tabular-nums text-foreground">{live.online ?? '—'}</strong>
          <span className="text-xs text-muted-foreground">online agora</span>
        </div>
        {!live.fresh && !isLoading && <button type="button" className="btn-ghost pointer-events-auto mt-2 text-xs" onClick={() => void mutate()}><RefreshCw className="size-3.5" />Atualizar</button>}
      </div>
      {live.countries.length > 0 && <p className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-full bg-background/90 px-3 py-1 text-[11px] text-muted-foreground">{live.countries.length} {live.countries.length === 1 ? 'país' : 'países'} · localização aproximada</p>}
    </div>
  )
}
