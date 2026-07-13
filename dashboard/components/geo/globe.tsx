'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import GlobeGL from 'react-globe.gl'
import { Crosshair, Minus, Plus } from 'lucide-react'
import { COUNTRY_COORDS } from '@/lib/country-coords'

interface GeoPoint {
  lat: number
  lng: number
  size: number
  color: string
  label: string
}

interface GeoArc {
  startLat: number
  startLng: number
  endLat: number
  endLng: number
}

interface GeoRing {
  lat: number
  lng: number
  /** intensidade 0–1 proporcional ao tráfego — modula o raio da onda */
  intensity: number
}

interface GeoLabel {
  lat: number
  lng: number
  text: string
  size: number
}

interface GlobePanelProps {
  countries: { code: string; name: string; count: number; purchased: number }[]
  /* Item 161: código do país em foco (hover na tabela) — gira o globo até ele */
  focusCode?: string | null
  /* Item 163: métrica ativa muda a cor dos pontos */
  metric?: 'visits' | 'sales'
}

// Cores da marca capturadas do legado
const CYAN = '#25f4ee'
const PINK = '#fe2c55'

const ALT_MIN = 1.2
const ALT_MAX = 3.5
const ALT_DEFAULT = 2.2
const ALT_STEP = 0.45
// Refino 8: entrada cinematográfica — altitude inicial e duração
const ALT_ENTRY = 4.0
const ENTRY_MS = 1200

// Refino 9: velocidades da interação magnética
const SPIN_IDLE = 0.35
const SPIN_HOVER = 0.9
const RESUME_AFTER_MS = 3000

function buildPoints(
  countries: GlobePanelProps['countries'],
  metric: 'visits' | 'sales' = 'visits',
) {
  // Item 163: em "vendas" só países com compra pontuam, em verde
  const base = metric === 'sales' ? countries.filter((c) => c.purchased > 0) : countries
  const max = Math.max(1, ...base.map((c) => (metric === 'sales' ? c.purchased : c.count)))
  const points: GeoPoint[] = base.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    const value = metric === 'sales' ? c.purchased : c.count
    return [
      {
        lat: coords[0],
        lng: coords[1],
        size: 0.28 + (Math.log1p(value) / Math.log1p(max)) * 0.72,
        color: metric === 'sales' ? '#22c55e' : c.purchased > 0 ? PINK : CYAN,
        label: `${c.name}: ${c.count} visitas${c.purchased ? ` · ${c.purchased} vendas` : ''}`,
      },
    ]
  })

  // Refino 5: anéis de pulso nos 3 países com mais tráfego, intensidade
  // proporcional (raio da onda cresce com o tráfego). Vendas continuam
  // pulsando em rosa via cor no ringColor.
  const top3 = countries.slice(0, 3)
  const topMax = Math.max(1, ...top3.map((c) => c.count))
  const rings: GeoRing[] = top3.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    return [{ lat: coords[0], lng: coords[1], intensity: c.count / topMax }]
  })

  // Refino 7: labels dos 3 maiores — nome + contagem em mono pequeno
  const labels: GeoLabel[] = top3.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    return [
      {
        lat: coords[0],
        lng: coords[1],
        text: `${c.name} · ${c.count}`,
        size: 0.85,
      },
    ]
  })

  // Item 32 / Refino 6: arcos de tráfego — dos demais países ativos para o líder
  const leader = countries[0]
  const leaderCoords = leader ? COUNTRY_COORDS[leader.code?.toUpperCase() ?? ''] : null
  const arcs: GeoArc[] = leaderCoords
    ? countries.slice(1, 6).flatMap((c) => {
        const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
        if (!coords) return []
        return [
          {
            startLat: coords[0],
            startLng: coords[1],
            endLat: leaderCoords[0],
            endLng: leaderCoords[1],
          },
        ]
      })
    : []
  return { points, rings, arcs, labels }
}

/** True apenas na primeira montagem do globo nesta sessão do navegador. */
function firstGlobeEntryThisSession(): boolean {
  try {
    if (sessionStorage.getItem('v0-once:globe-entry')) return false
    sessionStorage.setItem('v0-once:globe-entry', '1')
    return true
  } catch {
    return true
  }
}

/** Canvas do globo — único contexto WebGL da aplicação */
function GlobeCanvas({
  countries,
  width,
  height,
  globeRef,
  metric = 'visits',
}: GlobePanelProps & {
  width: number
  height: number
  globeRef: React.MutableRefObject<any>
}) {
  // Libera o contexto WebGL ao desmontar. O navegador limita a
  // ~8-16 contextos simultâneos — sem dispose, navegar entre abas
  // vaza contextos até o navegador matar os mais antigos ("context lost").
  useEffect(() => {
    const ref = globeRef
    return () => {
      const g = ref.current
      if (!g) return
      try {
        const renderer = g.renderer?.()
        renderer?.dispose?.()
        renderer?.forceContextLoss?.()
      } catch {
        /* renderer já liberado */
      }
      ref.current = null
    }
  }, [globeRef])

  // Item 289: com prefers-reduced-motion o globo fica estático (sem
  // auto-rotação nem zoom de entrada) — a interação manual continua livre.
  const reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = !reducedMotion
    g.controls().enableZoom = false

    // Fluidez: limita o pixelRatio a 1.5. Em telas Retina (DPR 2–3) o three.js
    // renderizava em resolução cheia, dobrando/triplicando o trabalho de
    // fragmento por frame — principal causa do globo "travado". 1.5 mantém
    // nitidez e corta o custo pela metade.
    try {
      const renderer = g.renderer?.()
      renderer?.setPixelRatio?.(Math.min(1.5, window.devicePixelRatio || 1))
    } catch {
      /* renderer indisponível nesta versão */
    }

    // Refino 8: entrada cinematográfica única por sessão — altitude 4.0→2.2
    // com ease-out do próprio pointOfView. Reduced-motion e navegações
    // seguintes pulam direto para o enquadramento final.
    if (!reducedMotion && firstGlobeEntryThisSession()) {
      g.pointOfView({ lat: 20, lng: -30, altitude: ALT_ENTRY }, 0)
      window.setTimeout(() => {
        globeRef.current?.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, ENTRY_MS)
      }, 60)
    } else {
      g.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, 0)
    }
    g.controls().autoRotateSpeed = SPIN_IDLE

    // Item 289: pausa o render loop com a aba oculta — three.js continuaria
    // gastando GPU em segundo plano sem isso.
    function onVisibility() {
      const globe = globeRef.current
      if (!globe) return
      try {
        if (document.hidden) globe.pauseAnimation()
        else globe.resumeAnimation()
      } catch {
        /* método indisponível na versão instalada */
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    // Fluidez: pausa o render loop quando o globo sai do viewport (scroll).
    let io: IntersectionObserver | null = null
    try {
      const canvasEl = g.renderer?.()?.domElement as HTMLCanvasElement | undefined
      if (canvasEl && typeof IntersectionObserver !== 'undefined') {
        io = new IntersectionObserver(
          (entries) => {
            const globe = globeRef.current
            if (!globe || document.hidden) return
            try {
              if (entries[0]?.isIntersecting) globe.resumeAnimation()
              else globe.pauseAnimation()
            } catch {
              /* método indisponível na versão instalada */
            }
          },
          { threshold: 0.05 },
        )
        io.observe(canvasEl)
      }
    } catch {
      /* renderer indisponível — segue sem pausa por viewport */
    }

    // Refino 3: emissive baixo no material do globo — massas de terra ganham
    // contraste no tema dark sem estourar o brilho.
    try {
      const mat = g.globeMaterial?.()
      if (mat) {
        mat.emissive?.set?.('#0a2a2e')
        mat.emissiveIntensity = 0.18
      }
    } catch {
      /* material indisponível nesta versão */
    }

    // Mais contraste: luzes mais fortes que os padrões suaves do three-globe.
    try {
      for (const light of g.lights()) {
        if (light.type === 'DirectionalLight') light.intensity = 2.1
        if (light.type === 'AmbientLight') light.intensity = 1.15
      }
    } catch {
      /* API de luzes indisponível nesta versão */
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      io?.disconnect()
    }
  }, [width, globeRef, reducedMotion])

  // Fluidez: memoizado — antes recalculava a cada render do pai (poll do
  // /api/live a cada 5s), forçando o three-globe a reconstruir tudo.
  const { points, rings, arcs, labels } = useMemo(
    () => buildPoints(countries, metric),
    [countries, metric],
  )

  return (
    <GlobeGL
      ref={globeRef}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      /* Refino 1: céu estrelado LOCAL — resolve o fundo vazio sem unpkg.
         URLs precisam do basePath /dashboard: o Next só o injeta em
         next/image e next/link, nunca em strings passadas a libs. */
      backgroundImageUrl="/dashboard/textures/night-sky.png"
      /* Refino 3: texturas locais — terra noturna + relevo topográfico */
      globeImageUrl="/dashboard/textures/earth-night.jpg"
      bumpImageUrl="/dashboard/textures/earth-topology.png"
      /* Refino 2: atmosfera ciano da marca */
      showAtmosphere
      atmosphereColor={CYAN}
      atmosphereAltitude={0.18}
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointAltitude={(d: object) => (d as GeoPoint).size * 0.22}
      pointRadius={(d: object) => (d as GeoPoint).size}
      pointLabel="label"
      pointsMerge={false}
      /* Refino 5: ondas concêntricas ciano nos hotspots, raio ∝ tráfego */
      ringsData={rings}
      ringColor={() => (t: number) => `rgba(37,244,238,${(1 - t) * 0.75})`}
      ringMaxRadius={(d: object) => 1.5 + (d as GeoRing).intensity * 1.5}
      ringPropagationSpeed={2}
      ringRepeatPeriod={1400}
      /* Refino 7: labels mono dos top países */
      labelsData={labels}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelSize="size"
      labelColor={() => 'rgba(255,255,255,0.85)'}
      labelDotRadius={0.28}
      labelAltitude={0.012}
      labelResolution={2}
      /* Item 32 / Refino 6: arcos ciano→rosa com dash fluindo rumo ao líder */
      arcsData={arcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={() => [CYAN, PINK]}
      arcAltitudeAutoScale={0.35}
      arcStroke={0.4}
      arcDashLength={0.4}
      arcDashGap={0.6}
      arcDashAnimateTime={2000}
    />
  )
}

/** Controles flutuantes: zoom + / − / recentrar */
function GlobeControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5" data-tour="globe-controls">
      <button type="button" onClick={onZoomIn} className="globe-ctl" aria-label="Aproximar">
        <Plus className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={onZoomOut} className="globe-ctl" aria-label="Afastar">
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={onRecenter} className="globe-ctl" aria-label="Recentrar globo">
        <Crosshair className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/* Refino 10: HUD fino — 4 cantos de mira + legenda de intensidade;
   estado vazio mantém o selo "aguardando tráfego" */
function GlobeHud({ empty }: { empty?: boolean }) {
  return (
    <>
      <span className="hud-corner hud-corner--tl" aria-hidden="true" />
      <span className="hud-corner hud-corner--tr" aria-hidden="true" />
      <span className="hud-corner hud-corner--bl" aria-hidden="true" />
      <span className="hud-corner hud-corner--br" aria-hidden="true" />
      {!empty && (
        <span
          className="pointer-events-none absolute bottom-3 right-3 z-10 flex items-center gap-1.5"
          aria-hidden="true"
        >
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">fraco</span>
          <span
            className="h-1 w-12 rounded-full"
            style={{ background: 'linear-gradient(90deg, rgba(37,244,238,.15), #25f4ee, #fe2c55)' }}
          />
          <span className="font-mono text-[9px] uppercase tracking-wider text-faint">forte</span>
        </span>
      )}
      {empty ? (
        <span className="globe-empty-note">
          <span className="rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
            Aguardando tráfego
          </span>
        </span>
      ) : null}
      {/* Refino 4: reflexo de chão ciano ancora o globo ao card */}
      <span className="globe-floor" aria-hidden="true" />
    </>
  )
}

function zoomBy(globeRef: React.MutableRefObject<any>, delta: number) {
  const g = globeRef.current
  if (!g) return
  const pov = g.pointOfView()
  const altitude = Math.min(ALT_MAX, Math.max(ALT_MIN, pov.altitude + delta))
  g.pointOfView({ ...pov, altitude }, 320)
}

export default function GlobePanel({ countries, focusCode, metric = 'visits' }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 320 })
  const resumeTimer = useRef<number | null>(null)

  const empty = countries.length === 0

  // Item 161: hover na tabela gira o globo até o país
  useEffect(() => {
    if (!focusCode) return
    const coords = COUNTRY_COORDS[focusCode.toUpperCase()]
    const g = globeRef.current
    if (!coords || !g) return
    const alt = g.pointOfView().altitude
    g.pointOfView({ lat: coords[0], lng: coords[1], altitude: alt }, 700)
  }, [focusCode])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      const h = entries[0].contentRect.height || 420
      setSize({ w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => () => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
  }, [])

  // Refino 9: interação magnética — hover acelera a rotação; arrastar pausa;
  // retoma sozinho após 3s de inatividade.
  function setSpin(speed: number) {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotateSpeed = speed
  }
  function pauseSpin() {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = false
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => {
      const g2 = globeRef.current
      if (!g2) return
      g2.controls().autoRotate = true
      g2.controls().autoRotateSpeed = SPIN_IDLE
    }, RESUME_AFTER_MS)
  }

  return (
    <div
      ref={containerRef}
      className="globe-stage relative h-full w-full overflow-hidden"
      data-tour="globe"
      onPointerEnter={() => setSpin(SPIN_HOVER)}
      onPointerLeave={() => setSpin(SPIN_IDLE)}
      onPointerDown={pauseSpin}
    >
      {size.w > 0 && (
        <GlobeCanvas
          countries={countries}
          width={size.w}
          height={size.h}
          globeRef={globeRef}
          metric={metric}
        />
      )}
      <GlobeHud empty={empty} />
      <GlobeControls
        onZoomIn={() => zoomBy(globeRef, -ALT_STEP)}
        onZoomOut={() => zoomBy(globeRef, ALT_STEP)}
        onRecenter={() =>
          globeRef.current?.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, 500)
        }
      />
    </div>
  )
}
