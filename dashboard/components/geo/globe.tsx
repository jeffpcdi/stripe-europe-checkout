'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import GlobeGL from 'react-globe.gl'
import { Crosshair, Maximize2, Minus, Plus, X } from 'lucide-react'
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
// Item 30: reentrada cinematográfica — começa distante e faz zoom-in
const ALT_ENTRY = 4.5
const ENTRY_MS = 1600

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
        size: 0.25 + (value / max) * 0.85,
        color: metric === 'sales' ? '#22c55e' : c.purchased > 0 ? PINK : CYAN,
        label: `${c.name}: ${c.count} visitas${c.purchased ? ` · ${c.purchased} vendas` : ''}`,
      },
    ]
  })
  // Anéis pulsantes apenas onde houve vendas — chamam atenção para conversões
  const rings = countries.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords || c.purchased <= 0) return []
    return [{ lat: coords[0], lng: coords[1] }]
  })
  // Item 32: arcos de tráfego — dos demais países ativos para o país líder
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
  return { points, rings, arcs }
}

/** Item 30/37: anima a chegada da órbita — zoom-in distante → próximo */
function playEntry(globeRef: React.MutableRefObject<any>) {
  const g = globeRef.current
  if (!g) return
  g.pointOfView({ lat: 20, lng: -30, altitude: ALT_ENTRY }, 0)
  g.controls().autoRotateSpeed = 2.4
  window.setTimeout(() => {
    g.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, ENTRY_MS)
  }, 60)
  window.setTimeout(() => {
    if (globeRef.current) globeRef.current.controls().autoRotateSpeed = 0.6
  }, ENTRY_MS + 120)
}

/** Canvas do globo — reutilizado no painel e na tela cheia */
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
  const entered = useRef(false)

  // Item 369: libera o contexto WebGL ao desmontar. O navegador limita a
  // ~8-16 contextos simultâneos — sem dispose, navegar entre abas (e abrir/
  // fechar a tela cheia, que monta um SEGUNDO canvas) vaza contextos até o
  // navegador começar a matar os mais antigos ("context lost" no globo).
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

    if (reducedMotion) {
      entered.current = true
      g.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, 0)
    } else if (!entered.current) {
      entered.current = true
      playEntry(globeRef)
    } else {
      g.controls().autoRotateSpeed = 0.6
    }

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
    // Sem isso o three.js segue renderizando a 60fps invisível, roubando GPU
    // dos cards e gráficos visíveis.
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

    // Mais contraste: luzes mais fortes que os padrões suaves do three-globe.
    // Intensidades compensam a remoção do filter CSS no canvas (que custava
    // uma passada de composição por frame).
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

  // Fluidez: memoizado — antes recalculava (e recriava os arrays) a cada
  // render do pai (poll do /api/live a cada 5s), forçando o three-globe a
  // reconstruir pontos/anéis/arcos mesmo sem mudança real nos dados.
  const { points, rings, arcs } = useMemo(() => buildPoints(countries, metric), [countries, metric])

  return (
    <GlobeGL
      ref={globeRef}
      width={width}
      height={height}
      backgroundColor="rgba(0,0,0,0)"
      backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
      globeImageUrl="//unpkg.com/three-globe/example/img/earth-blue-marble.jpg"
      bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
      atmosphereColor={CYAN}
      atmosphereAltitude={0.22}
      pointsData={points}
      pointLat="lat"
      pointLng="lng"
      pointColor="color"
      pointAltitude={(d: object) => (d as GeoPoint).size * 0.22}
      pointRadius={(d: object) => (d as GeoPoint).size}
      pointLabel="label"
      pointsMerge={false}
      ringsData={rings}
      ringColor={() => (t: number) => `rgba(254,44,85,${1 - t})`}
      ringMaxRadius={4}
      ringPropagationSpeed={2}
      ringRepeatPeriod={900}
      /* Item 32: arcos ciano→rosa com dash animado rumo ao país líder */
      arcsData={arcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={() => [CYAN, PINK]}
      arcAltitudeAutoScale={0.35}
      arcStroke={0.4}
      arcDashLength={0.45}
      arcDashGap={0.6}
      arcDashAnimateTime={2400}
    />
  )
}

/** Controles flutuantes: zoom + / − / recentrar / tela cheia */
function GlobeControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
  onFullscreen,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
  onFullscreen?: () => void
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5" data-tour="globe-controls">
      <button type="button" onClick={onZoomIn} className="globe-ctl" aria-label="Aproximar">
        <Plus className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={onZoomOut} className="globe-ctl" aria-label="Afastar">
        <Minus className="size-4" aria-hidden="true" />
      </button>
      {/* Item 37: recentrar refaz a animação de reentrada */}
      <button type="button" onClick={onRecenter} className="globe-ctl" aria-label="Recentrar globo">
        <Crosshair className="size-4" aria-hidden="true" />
      </button>
      {onFullscreen && (
        <button
          type="button"
          onClick={onFullscreen}
          className="globe-ctl"
          aria-label="Tela cheia"
        >
          <Maximize2 className="size-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

/* Item 35: HUD orbital — corner brackets + legenda mono */
function GlobeHud({ empty }: { empty?: boolean }) {
  return (
    <>
      <span className="hud-corner hud-corner--tl" aria-hidden="true" />
      <span className="hud-corner hud-corner--tr" aria-hidden="true" />
      <span className="hud-corner hud-corner--bl" aria-hidden="true" />
      <span className="hud-corner hud-corner--br" aria-hidden="true" />
      {/* Alinhado à esquerda para nunca colidir com a legenda de intensidade à direita */}
      <span
        className="label-mono pointer-events-none absolute bottom-3 left-8 z-10 whitespace-nowrap text-[9.5px] opacity-70"
        aria-hidden="true"
      >
        ROI-NADOS · TRÁFEGO GLOBAL
      </span>
      {/* Item 165: mini-legenda de intensidade */}
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
      {/* Item 166: estado sem dados */}
      {empty ? (
        <span className="globe-empty-note">
          <span className="glass rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            aguardando tráfego
          </span>
        </span>
      ) : null}
      {/* Item 98: reflexo de chão ciano na base */}
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

/* Item 34: rotação desacelera no hover e retoma ao sair */
function hoverSpeed(globeRef: React.MutableRefObject<any>, hovering: boolean) {
  const g = globeRef.current
  if (!g) return
  g.controls().autoRotateSpeed = hovering ? 0.15 : 0.6
}

export default function GlobePanel({ countries, focusCode, metric = 'visits' }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const fsGlobeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 420 })
  const [fsSize, setFsSize] = useState({ w: 0, h: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [closing, setClosing] = useState(false)

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
      // Item 172: mede também a altura — 55vh em mobile, 420px em desktop
      const w = entries[0].contentRect.width
      const h = entries[0].contentRect.height || 420
      setSize({ w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fecha com animação de saída antes de desmontar
  const closeFullscreen = useCallback(() => {
    setClosing(true)
    window.setTimeout(() => {
      setFullscreen(false)
      setClosing(false)
    }, 220)
  }, [])

  // Tamanho + Escape enquanto a tela cheia está aberta
  useEffect(() => {
    if (!fullscreen) return
    const measure = () =>
      setFsSize({ w: window.innerWidth - 32, h: window.innerHeight - 96 })
    measure()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFullscreen()
    }
    window.addEventListener('resize', measure)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [fullscreen, closeFullscreen])

  return (
    <>
      <div
        ref={containerRef}
        className="globe-stage energy-border relative h-[55vh] w-full overflow-hidden rounded-xl md:h-[420px]"
        data-tour="globe"
        onPointerEnter={() => hoverSpeed(globeRef, true)}
        onPointerLeave={() => hoverSpeed(globeRef, false)}
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
          onRecenter={() => playEntry(globeRef)}
          onFullscreen={() => setFullscreen(true)}
        />
      </div>

      {fullscreen &&
        createPortal(
          <div
            className={`globe-modal ${closing ? 'globe-modal--closing' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label="Globo em tela cheia"
          >
            <button
              type="button"
              className="globe-modal__backdrop"
              aria-label="Fechar tela cheia"
              onClick={closeFullscreen}
            />
            <div
              className="globe-modal__panel globe-stage"
              onPointerEnter={() => hoverSpeed(fsGlobeRef, true)}
              onPointerLeave={() => hoverSpeed(fsGlobeRef, false)}
            >
              <button
                type="button"
                onClick={closeFullscreen}
                className="globe-ctl absolute left-3 top-3 z-10"
                aria-label="Fechar"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
              {fsSize.w > 0 && (
                <GlobeCanvas
                  countries={countries}
                  width={fsSize.w}
                  height={fsSize.h}
                  globeRef={fsGlobeRef}
                  metric={metric}
                />
              )}
              <GlobeHud empty={empty} />
              <GlobeControls
                onZoomIn={() => zoomBy(fsGlobeRef, -ALT_STEP)}
                onZoomOut={() => zoomBy(fsGlobeRef, ALT_STEP)}
                onRecenter={() => playEntry(fsGlobeRef)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
