'use client'

// Refinamento: o globo é a peça central IMERSIVA do BLOCO HERO — ocupa toda a
// largura do hero com KPIs e LiveFeed sobrepostos via absolute. O counter na
// base mostra "ONLINE AGORA" (tempo real de /api/live), não "leads hoje".
// Badge com glassmorphism na base do globo.

import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLive } from '@/lib/api'
import { timeAgo } from '@/lib/format'
import { CountUp } from '@/components/count-up'
import { ShootingStars } from './shooting-stars'
import type { GeoPulse } from '@/components/geo/globe'
import type { LiveCountry } from '@/lib/types'

/* V2-54: skeleton do globo — esfera com anel orbital girando */
function GlobeSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative aspect-square w-[60%] max-w-96" aria-hidden="true">
        <div className="absolute inset-0 animate-pulse rounded-full border border-brand-cyan/10 bg-brand-cyan/5" />
        <div
          className="anim-orbit-slow absolute -inset-4 rounded-full border border-dashed"
          style={{ borderColor: 'rgba(37,244,238,0.18)' }}
        />
        <div className="brand-spinner absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" />
      </div>
      <span className="sr-only">Carregando presença ao vivo</span>
    </div>
  )
}

const GlobePanel = dynamic(() => import('@/components/geo/globe'), {
  ssr: false,
  loading: () => <GlobeSkeleton />,
})

// Fase 5: quanto tempo um anel de "lead novo" fica visível no globo.
const PULSE_TTL_MS = 6000

/**
 * Detecta leads novos comparando a contagem por país entre polls consecutivos
 * do /api/live (cadência de 5s). Um aumento de `count` num país vira um pulso
 * com TTL, que o globo desenha como anel temporário. Robusto a:
 *  - primeiro poll: só semeia a baseline, NÃO dispara pulsos (evita enxurrada
 *    inicial ao abrir a tela);
 *  - quedas de count (visitante saiu): ignoradas;
 *  - países novos na lista: contam do zero como pulso.
 * Não guarda PII — apenas o código do país e um contador.
 */
function useLeadPulses(countries: LiveCountry[]): GeoPulse[] {
  const [pulses, setPulses] = useState<GeoPulse[]>([])
  const prevCounts = useRef<Map<string, number> | null>(null)
  const keySeq = useRef(0)

  useEffect(() => {
    const next = new Map<string, number>()
    for (const c of countries) next.set(c.code, c.count || 0)

    // primeiro poll → só estabelece baseline, sem pulsos
    if (prevCounts.current === null) {
      prevCounts.current = next
      return
    }

    const fresh: GeoPulse[] = []
    for (const [code, count] of next) {
      const before = prevCounts.current.get(code) ?? 0
      if (count > before) fresh.push({ code, key: ++keySeq.current })
    }
    prevCounts.current = next

    if (fresh.length === 0) return
    setPulses((cur) => [...cur, ...fresh])

    // expira esse lote após o TTL (cada lote tem seu próprio timer)
    const expiring = new Set(fresh.map((p) => p.key))
    const t = window.setTimeout(() => {
      setPulses((cur) => cur.filter((p) => !expiring.has(p.key)))
    }, PULSE_TTL_MS)
    return () => window.clearTimeout(t)
  }, [countries])

  return pulses
}

export function HeroGlobe({
  countries,
  lastLeadAt,
}: {
  /** países dos leads de HOJE — usados apenas como métrica de "vendas"
      (purchased) para tingir de rosa os totens de países que compraram.
      Os TOTENS em si são guiados pelo AO VIVO (veja abaixo). */
  countries: { code: string; name: string; count: number; purchased: number }[]
  /** ISO do lead mais recente (qualquer período) — null se NUNCA houve lead.
      Distingue "tracking nunca configurado" de "só está quieto agora". */
  lastLeadAt?: string | null
}) {
  // /api/live alimenta TUDO agora: counter "online agora", PULSOS (anéis de
  // lead novo) e os TOTENS. Antes os totens vinham dos leads acumulados de
  // hoje — o globo mostrava 4 espetos ciano com "ONLINE AGORA · 0" logo
  // acima, contradição direta. Pedido do usuário: totem só com gente NO SITE
  // agora, altura proporcional à demanda de cada país.
  const { data, error: liveError } = useLive()
  const liveCountries = data?.summary.countries ?? []
  const onlineNow = data?.summary.online ?? 0
  const activeCountries = liveCountries.length
  const pulses = useLeadPulses(liveCountries)

  // 3 estados vazios distintos (antes era 1 genérico que mentia):
  // (a) erro de fetch → aviso discreto, sem fingir que "não há tráfego";
  // (b) nunca houve lead → o problema é setup, CTA para configurar;
  // (c) tracking ok, só quieto → "Aguardando visitantes · última há Xmin".
  const emptyNote = liveError ? (
    <span className="rounded-full border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning">
      Sem conexão com o tempo real — tentando de novo…
    </span>
  ) : !lastLeadAt ? (
    <Link
      href="/links"
      className="pointer-events-auto rounded-full border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20"
    >
      Nenhuma visita registrada ainda — configurar rastreamento
    </Link>
  ) : (
    <span className="anim-breathe rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
      Aguardando visitantes · última visita {timeAgo(lastLeadAt)}
    </span>
  )

  // Totens = presença ao vivo. `purchased` vem de hoje (o /api/live não traz
  // vendas) só para manter o tom rosa em países que já compraram no dia.
  const liveGlobeCountries = useMemo(() => {
    const purchasedByCode = new Map(countries.map((c) => [c.code, c.purchased]))
    return liveCountries.map((c) => ({
      code: c.code,
      name: c.name,
      count: c.count,
      purchased: purchasedByCode.get(c.code) ?? 0,
    }))
  }, [liveCountries, countries])

  return (
    /* O globo agora ocupa TODA a largura/altura do hero. Sem max-w — o
       container externo (overview-view) controla o tamanho. */
    <div
      className="hero-globe-container absolute inset-0 bg-breathe"
      aria-label={`Presença ao vivo: ${onlineNow} online agora em ${activeCountries} ${activeCountries === 1 ? 'país' : 'países'}`}
    >
      {/* Glow atmosférico e Elementos Orbitais (Mega Plano) */}
      <div className="hero-globe-glow-outer" aria-hidden="true" />
      <div className="hero-globe-glow-core" aria-hidden="true" />
      <div className="hero-stardust float-dust" aria-hidden="true" />
      <ShootingStars />
      
      <div className="hero-orbit-ring" aria-hidden="true" />
      <div className="hero-orbit-ring outer" aria-hidden="true" />

      {/* Totens/pontos guiados pelo AO VIVO: com 0 online o globo fica limpo
          ("Aguardando tráfego"), consistente com o contador logo acima. Arcos
          idem — só com gente no site agora. */}
      <GlobePanel
        countries={liveGlobeCountries}
        metric="visits"
        pulses={pulses}
        showArcs={onlineNow > 0}
        emptyNote={emptyNote}
      />

      {/* Badge glassmorphism sobreposto na base — "ONLINE AGORA · N PAÍSES".
          pointer-events-none para não interceptar arraste/zoom do globo. */}
      <div className="pointer-events-none absolute inset-x-0 top-6 flex flex-col items-center gap-1.5 text-center z-20">
        <div className="hero-globe-badge pulse-cyan pointer-events-auto inline-flex flex-col items-center gap-1.5 px-6 py-2.5 rounded-[20px] backdrop-blur-xl border border-primary/20 shadow-[0_0_25px_rgba(37,244,238,0.3)] transition-all">
          <div className="flex items-center gap-2">
            <span className="live-dot" aria-hidden="true" />
            <p
              className="font-mono text-2xl font-bold leading-none tabular-nums text-white xl:text-3xl"
              data-sensitive
            >
              <CountUp value={onlineNow} />
            </p>
          </div>
          <p className="text-[9.5px] font-medium uppercase tracking-[0.12em] text-white/60">
            online agora · {activeCountries}{' '}
            {activeCountries === 1 ? 'país' : 'países'}
          </p>
        </div>
      </div>
    </div>
  )
}
