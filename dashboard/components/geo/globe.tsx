'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import GlobeGL from 'react-globe.gl'
import { Crosshair, Maximize2, Minimize2, Minus, Plus } from 'lucide-react'
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

/* Fase 5: ping externo de lead novo. `key` identifica o pulso (TTL controlado
   pelo pai); resolvido para coordenadas aqui, virando um anel temporário. */
export interface GeoPulse {
  code: string
  key: number
}

interface GlobePanelProps {
  countries: { code: string; name: string; count: number; purchased: number }[]
  /* Item 161: código do país em foco (hover na tabela) — gira o globo até ele */
  focusCode?: string | null
  /* Item 163: métrica ativa muda a cor dos pontos */
  metric?: 'visits' | 'sales'
  /* Fase 5: pulsos externos (lead novo detectado no poll) → anéis temporários */
  pulses?: GeoPulse[]
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

// Refino 9: velocidades da interação magnética — idle mais rápido para o
// globo nunca parecer "travado" mesmo sem tráfego
const SPIN_IDLE = 0.65
const SPIN_HOVER = 1.3
const RESUME_AFTER_MS = 3000

function buildPoints(
  countries: GlobePanelProps['countries'],
  metric: 'visits' | 'sales' = 'visits',
  pulses: GeoPulse[] = [],
) {
  // Fase 5: países ativos sem coordenadas no mapa são omitidos silenciosamente
  // do render — mas contabilizamos para diagnosticar falta de cobertura.
  const omitted: string[] = []
  for (const c of countries) {
    if (!COUNTRY_COORDS[c.code?.toUpperCase() ?? '']) omitted.push(c.code)
  }
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

  // V2-41: anéis de pulso agora nos 5 países com mais tráfego (era 3) —
  // o globo parece mais vivo com múltiplas ondas simultâneas.
  const topRinged = countries.slice(0, 5)
  const topMax = Math.max(1, ...topRinged.map((c) => c.count))
  const rings: GeoRing[] = topRinged.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    return [{ lat: coords[0], lng: coords[1], intensity: c.count / topMax }]
  })

  // Fase 5: cada pulso de lead novo vira um anel temporário em intensidade
  // máxima (onda ampla e nítida). O TTL é gerido pelo pai (hero-globe) — quando
  // o pulso sai da lista, o anel some no próximo render.
  for (const p of pulses) {
    const coords = COUNTRY_COORDS[p.code?.toUpperCase() ?? '']
    if (coords) rings.push({ lat: coords[0], lng: coords[1], intensity: 1 })
  }

  // V2-42: labels dos 3 maiores, maiores e mais legíveis (0.85 → 1.0)
  const labels: GeoLabel[] = countries.slice(0, 3).flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    return [
      {
        lat: coords[0],
        lng: coords[1],
        text: `${c.name} · ${c.count}`,
        size: 1.0,
      },
    ]
  })

  // V2-43: mais arcos de tráfego — até 8 origens (era 5) convergindo ao líder
  const leader = countries[0]
  const leaderCoords = leader ? COUNTRY_COORDS[leader.code?.toUpperCase() ?? ''] : null
  const arcs: GeoArc[] = leaderCoords
    ? countries.slice(1, 9).flatMap((c) => {
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
  return { points, rings, arcs, labels, omitted }
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
  pulses = [],
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

    // V2-44: entrada cinematográfica aprimorada — além do zoom 4.0→2.2, o
    // globo agora gira 60° de longitude durante a aproximação (efeito
    // "chegando da órbita"). Única por sessão; reduced-motion pula direto.
    if (!reducedMotion && firstGlobeEntryThisSession()) {
      g.pointOfView({ lat: 8, lng: -90, altitude: ALT_ENTRY }, 0)
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

    // V2-45: material aprimorado — emissive ciano mais presente + shininess
    // para o oceano refletir a luz como água (specular sutil da marca).
    try {
      const mat = g.globeMaterial?.()
      if (mat) {
        mat.emissive?.set?.('#0b3a40')
        mat.emissiveIntensity = 0.28
        mat.shininess = 12
        mat.specular?.set?.('#1a6b70')
      }
    } catch {
      /* material indisponível nesta versão */
    }

    // V2-46: luzes com temperatura da marca — a direcional puxa levemente
    // para ciano-frio, dando ao globo o tom "neon noite" do dashboard.
    try {
      for (const light of g.lights()) {
        if (light.type === 'DirectionalLight') {
          light.intensity = 2.5
          light.color?.set?.('#eafffe')
        }
        if (light.type === 'AmbientLight') light.intensity = 1.55
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
  // Fase 5: `pulses` entra na dependência — muda só quando um ping é
  // adicionado/expira (cadência do poll de 5s), nunca por frame.
  const { points, rings, arcs, labels, omitted } = useMemo(
    () => buildPoints(countries, metric, pulses),
    [countries, metric, pulses],
  )

  // Fase 5: alerta de cobertura — quantos países ativos ficaram fora do mapa
  // por falta de coordenadas em country-coords.ts. Só loga quando o conjunto
  // muda (assinatura), evitando ruído a cada poll.
  const omittedSig = omitted.join(',')
  useEffect(() => {
    if (omitted.length > 0) {
      console.warn(
        `[globo] ${omitted.length} país(es) ativos sem coordenadas foram omitidos do mapa: ${omitted.join(', ')}. Amplie country-coords.ts para cobri-los.`,
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [omittedSig])

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
      /* Textura blue-marble (dia): continentes visíveis de longe — a
         earth-night deixava o globo escuro demais no card do overview */
      globeImageUrl="/dashboard/textures/earth-blue-marble.jpg"
      bumpImageUrl="/dashboard/textures/earth-topology.png"
      /* V2-47: atmosfera mais volumosa (0.18 → 0.22) — halo ciano visível */
      showAtmosphere
      atmosphereColor={CYAN}
      atmosphereAltitude={0.22}
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      /* V2-48: colunas mais altas nos hotspots (0.22 → 0.3) — leitura 3D */
      pointAltitude={(d: object) => (d as GeoPoint).size * 0.3}
      pointRadius={(d: object) => (d as GeoPoint).size}
      pointLabel="label"
      pointsMerge={false}
      /* V2-49: transição suave quando os dados do poll mudam */
      pointsTransitionDuration={600}
      /* Refino 5 + V2-41: ondas concêntricas nos 5 hotspots, raio ∝ tráfego */
      ringsData={rings}
      ringColor={() => (t: number) => `rgba(37,244,238,${(1 - t) * 0.75})`}
      ringMaxRadius={(d: object) => 1.5 + (d as GeoRing).intensity * 1.5}
      ringPropagationSpeed={2}
      ringRepeatPeriod={1400}
      /* V2-42: labels mono maiores com dot mais visível */
      labelsData={labels}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelSize="size"
      labelColor={() => 'rgba(255,255,255,0.92)'}
      labelDotRadius={0.34}
      labelAltitude={0.014}
      labelResolution={2}
      /* V2-50: arcos mais grossos (0.4 → 0.5) e dash mais rápido (2s → 1.4s)
         — o fluxo de tráfego rumo ao líder fica óbvio à primeira vista */
      arcsData={arcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={() => [CYAN, PINK]}
      arcAltitudeAutoScale={0.35}
      arcStroke={0.5}
      arcDashLength={0.35}
      arcDashGap={0.55}
      arcDashAnimateTime={1400}
      arcsTransitionDuration={600}
    />
  )
}

/** Controles flutuantes: zoom + / − / recentrar / tela cheia */
function GlobeControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
  onFullscreen,
  isFullscreen,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
  onFullscreen: () => void
  isFullscreen: boolean
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
      <button
        type="button"
        onClick={onFullscreen}
        className="globe-ctl"
        aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
      >
        {isFullscreen ? (
          <Minimize2 className="size-4" aria-hidden="true" />
        ) : (
          <Maximize2 className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

/* Refino 10 + V2-51/52/53: HUD orbital completo — cantos de mira, legenda,
   vinheta interna que foca o globo no centro e anel de latitude decorativo */
function GlobeHud({ empty }: { empty?: boolean }) {
  return (
    <>
      <span className="hud-corner hud-corner--tl" aria-hidden="true" />
      <span className="hud-corner hud-corner--tr" aria-hidden="true" />
      <span className="hud-corner hud-corner--bl" aria-hidden="true" />
      <span className="hud-corner hud-corner--br" aria-hidden="true" />
      {/* V2-51: vinheta radial interna — bordas escurecem, globo salta */}
      <span
        className="pointer-events-none absolute inset-0 z-[2]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 75% 70% at 50% 48%, transparent 62%, rgba(0,0,0,0.42) 100%)',
        }}
      />
      {/* V2-52: anel orbital decorativo girando atrás dos controles */}
      <span
        className="anim-orbit-slow pointer-events-none absolute left-1/2 top-1/2 z-[1] hidden size-[68%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed sm:block"
        aria-hidden="true"
        style={{ borderColor: 'rgba(37,244,238,0.08)' }}
      />
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
      {/* V2-53: selo de coordenadas mono no canto — assinatura HUD */}
      {!empty && (
        <span
          className="pointer-events-none absolute bottom-3 left-3 z-10 hidden font-mono text-[9px] uppercase tracking-[0.18em] sm:block"
          aria-hidden="true"
          style={{ color: 'rgba(37,244,238,0.4)' }}
        >
          LIVE·ORBIT
        </span>
      )}
      {empty ? (
        <span className="globe-empty-note">
          <span className="anim-breathe rounded-full border border-border bg-background/80 px-3 py-1.5 text-xs text-muted-foreground">
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

export default function GlobePanel({
  countries,
  focusCode,
  metric = 'visits',
  pulses = [],
}: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 320 })
  const resumeTimer = useRef<number | null>(null)
  // Tela cheia nativa no container — o ResizeObserver já redimensiona o canvas
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current)
    }
    document.addEventListener('fullscreenchange', onFsChange)
    return () => document.removeEventListener('fullscreenchange', onFsChange)
  }, [])

  function toggleFullscreen() {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {})
    } else {
      el.requestFullscreen?.().catch(() => {})
    }
  }

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
          pulses={pulses}
        />
      )}
      <GlobeHud empty={empty} />
      {/* Redesign: os números da base saíram daqui — agora moram no overlay do
          HeroGlobe (contagem grande DENTRO do globo). Só fica o selo "ao vivo"
          quando há pulso de lead novo (Fase 5). */}
      {pulses.length > 0 && (
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-1.5 font-mono text-[10.5px] tabular-nums text-emerald-400/90">
          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          ao vivo
        </div>
      )}
      <GlobeControls
        onZoomIn={() => zoomBy(globeRef, -ALT_STEP)}
        onZoomOut={() => zoomBy(globeRef, ALT_STEP)}
        onRecenter={() =>
          globeRef.current?.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, 500)
        }
        onFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />
    </div>
  )
}
