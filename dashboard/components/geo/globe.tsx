'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import GlobeGL from 'react-globe.gl'
import { Maximize2, Minus, Plus, X } from 'lucide-react'
import { COUNTRY_COORDS } from '@/lib/country-coords'

interface GeoPoint {
  lat: number
  lng: number
  size: number
  color: string
  label: string
}

interface GlobePanelProps {
  countries: { code: string; name: string; count: number; purchased: number }[]
}

// Cores da marca capturadas do legado
const CYAN = '#25f4ee'
const PINK = '#fe2c55'

const ALT_MIN = 1.2
const ALT_MAX = 3.5
const ALT_DEFAULT = 2.2
const ALT_STEP = 0.45

function buildPoints(countries: GlobePanelProps['countries']) {
  const max = Math.max(1, ...countries.map((c) => c.count))
  const points: GeoPoint[] = countries.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    return [
      {
        lat: coords[0],
        lng: coords[1],
        size: 0.25 + (c.count / max) * 0.85,
        color: c.purchased > 0 ? PINK : CYAN,
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
  return { points, rings }
}

/** Canvas do globo — reutilizado no painel e na tela cheia */
function GlobeCanvas({
  countries,
  width,
  height,
  globeRef,
}: GlobePanelProps & {
  width: number
  height: number
  globeRef: React.MutableRefObject<any>
}) {
  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = true
    g.controls().autoRotateSpeed = 0.6
    g.controls().enableZoom = false
    g.pointOfView({ lat: 20, lng: -30, altitude: ALT_DEFAULT }, 0)

    // Mais contraste: luzes mais fortes que os padrões suaves do three-globe
    try {
      for (const light of g.lights()) {
        if (light.type === 'DirectionalLight') light.intensity = 1.6
        if (light.type === 'AmbientLight') light.intensity = 0.9
      }
    } catch {
      /* API de luzes indisponível — o filtro CSS já garante o contraste */
    }
  }, [width, globeRef])

  const { points, rings } = buildPoints(countries)

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
    />
  )
}

/** Controles flutuantes: zoom + / − e tela cheia — estilo do legado */
function GlobeControls({
  onZoomIn,
  onZoomOut,
  onFullscreen,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFullscreen?: () => void
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5">
      <button type="button" onClick={onZoomIn} className="globe-ctl" aria-label="Aproximar">
        <Plus className="size-4" aria-hidden="true" />
      </button>
      <button type="button" onClick={onZoomOut} className="globe-ctl" aria-label="Afastar">
        <Minus className="size-4" aria-hidden="true" />
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

function zoomBy(globeRef: React.MutableRefObject<any>, delta: number) {
  const g = globeRef.current
  if (!g) return
  const pov = g.pointOfView()
  const altitude = Math.min(ALT_MAX, Math.max(ALT_MIN, pov.altitude + delta))
  g.pointOfView({ ...pov, altitude }, 320)
}

export default function GlobePanel({ countries }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const fsGlobeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 420 })
  const [fsSize, setFsSize] = useState({ w: 0, h: 0 })
  const [fullscreen, setFullscreen] = useState(false)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width
      setSize({ w, h: 420 })
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
        className="globe-stage relative h-[420px] w-full overflow-hidden rounded-xl"
      >
        {size.w > 0 && (
          <GlobeCanvas
            countries={countries}
            width={size.w}
            height={size.h}
            globeRef={globeRef}
          />
        )}
        <GlobeControls
          onZoomIn={() => zoomBy(globeRef, -ALT_STEP)}
          onZoomOut={() => zoomBy(globeRef, ALT_STEP)}
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
            <div className="globe-modal__panel globe-stage">
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
                />
              )}
              <GlobeControls
                onZoomIn={() => zoomBy(fsGlobeRef, -ALT_STEP)}
                onZoomOut={() => zoomBy(fsGlobeRef, ALT_STEP)}
              />
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
