'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import GlobeGL from 'react-globe.gl'
import * as THREE from 'three'
import { Crosshair, Maximize2, Minimize2, Minus, Plus, Play, Pause } from 'lucide-react'
import { COUNTRY_COORDS } from '@/lib/country-coords'

interface GeoPoint {
  lat: number
  lng: number
  size: number
  color: string
  label: string
}

interface GeoTotem {
  lat: number
  lng: number
  height: number
  radius: number
  color: string
  label: string
  code: string
  name: string
  count: number
  purchased: number
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
  metric?: 'visits' | 'sales' | 'live' | 'all'
  /* Fase 5: pulsos externos (lead novo detectado no poll) → anéis temporários */
  pulses?: GeoPulse[]
  /* Arcos de tráfego só fazem sentido com gente NO SITE agora — o pai liga/
     desliga conforme a presença ao vivo (/api/live). Default true para não
     mudar o comportamento de outros usos do globo. */
  showArcs?: boolean
  /* Nota contextual do estado vazio (HeroGlobe passa a mensagem certa por
     situação: sem tracking / sem visitantes / erro). Sem ela, texto genérico. */
  emptyNote?: React.ReactNode
}

// Cores da marca capturadas do legado
const CYAN = '#25f4ee'
const PINK = '#fe2c55'

const ALT_MIN = 1.02
const ALT_MAX = 3.5
const ALT_DEFAULT = 1.62
const ALT_STEP = 0.28
// Entrada curta e suave: dá profundidade sem atrasar a leitura dos dados.
const ALT_ENTRY = 2.8
const ENTRY_MS = 1000

// Movimento propositalmente contido: o globo deve sustentar a leitura, não
// competir com os números e a lista de atividade sobre ele.
const SPIN_IDLE = 0.18
const SPIN_HOVER = 0.32
const RESUME_AFTER_MS = 4000
const MAX_AMBIENT_RINGS = 3
const MAX_LABELS = 2
const MAX_ARCS = 3

function escapeHtml(value: string): string {
  return String(value).replace(/[&<>'"]/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[char] ?? char)
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  return reduced
}

function createTotemMesh(d: GeoTotem): any {
  const group = new THREE.Group()

  // 1. Cilindro principal 3D (haste de acesso vertical idêntica ao mapa ao vivo da Shopify)
  const geom = new THREE.CylinderGeometry(d.radius, d.radius * 1.05, d.height, 24)
  geom.rotateX(Math.PI / 2)
  geom.translate(0, 0, d.height / 2)

  const mat = new THREE.MeshStandardMaterial({
    color: d.color,
    emissive: d.color,
    emissiveIntensity: 0.92,
    roughness: 0.22,
    metalness: 0.15,
  })
  const cylinder = new THREE.Mesh(geom, mat)
  group.add(cylinder)

  // 2. Farol / Beacon luminoso no topo da haste cilíndrica
  const capGeom = new THREE.SphereGeometry(d.radius * 1.3, 16, 12)
  capGeom.translate(0, 0, d.height)
  const capMat = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    emissive: d.color,
    emissiveIntensity: 1.25,
    roughness: 0.08,
  })
  const cap = new THREE.Mesh(capGeom, capMat)
  group.add(cap)

  // 3. Disco de ancoragem na crosta da Terra (translúcido para não encobrir a geografia)
  const baseGeom = new THREE.RingGeometry(d.radius * 0.7, d.radius * 2.2, 24)
  baseGeom.translate(0, 0, 0.04)
  const baseMat = new THREE.MeshBasicMaterial({
    color: d.color,
    transparent: true,
    opacity: 0.52,
    side: THREE.DoubleSide,
  })
  const baseRing = new THREE.Mesh(baseGeom, baseMat)
  group.add(baseRing)

  return group
}

function buildPoints(
  countries: GlobePanelProps['countries'],
  metric: 'visits' | 'sales' | 'live' | 'all' = 'all',
  pulses: GeoPulse[] = [],
) {
  // Filtra de acordo com a métrica:
  // - sales: apenas países com compras (c.purchased > 0)
  // - live / visits: apenas países com visitantes navegando ao vivo (c.count > 0)
  // - all: apenas países com visitantes navegando ao vivo E/OU compras
  const base = countries
    .filter((c) => {
      if (metric === 'sales') return (c.purchased || 0) > 0
      if (metric === 'live' || metric === 'visits') return (c.count || 0) > 0
      return (c.count || 0) > 0 || (c.purchased || 0) > 0
    })
    .slice()
    .sort((a, b) => {
      const av = metric === 'sales' ? a.purchased : metric === 'live' ? a.count : (a.purchased * 3 + a.count)
      const bv = metric === 'sales' ? b.purchased : metric === 'live' ? b.count : (b.purchased * 3 + b.count)
      return bv - av
    })
  const max = Math.max(
    1,
    ...base.map((c) =>
      metric === 'sales'
        ? c.purchased
        : metric === 'live'
        ? c.count
        : Math.max(c.count || 0, c.purchased || 0)
    )
  )

  // Totens 3D verticais (estilo mapa ao vivo da Shopify): colunas cilíndricas que sobem da Terra
  const totems: GeoTotem[] = base.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    const value =
      metric === 'sales'
        ? c.purchased
        : metric === 'live'
        ? c.count
        : (c.purchased > 0 ? c.purchased : c.count)
    // Altura proporcional: 10 unidades (mínimo visível) até 30 unidades no globo
    const norm = Math.log1p(value) / Math.log1p(max)
    const height = 10 + norm * 20
    const radius = 0.7 + norm * 0.35
    const isSale = metric === 'sales' || (metric === 'all' && c.purchased > 0)
    const color = isSale ? '#10b981' : '#22d3ee'

    return [
      {
        lat: coords[0],
        lng: coords[1],
        height,
        radius,
        color,
        code: c.code,
        name: c.name,
        count: c.count,
        purchased: c.purchased,
        label: `<div style="background: rgba(8, 10, 16, 0.94); backdrop-filter: blur(16px); -webkit-backdrop-filter: blur(16px); padding: 9px 13px; border-radius: 12px; border: 1px solid rgba(56, 189, 248, 0.25); box-shadow: 0 12px 36px rgba(0,0,0,0.7); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; font-size: 11px; color: #fff;">
          <div style="display: flex; align-items: center; gap: 6px; font-weight: 600; margin-bottom: 4px; font-size: 12px;">
            <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${color}; box-shadow: 0 0 8px ${color};"></span>
            <span>${escapeHtml(c.name)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 8px; font-size: 10.5px; color: rgba(255,255,255,0.75);">
            ${c.count > 0 ? `<span style="font-weight: 500; color: #22d3ee;">${c.count} ${c.count === 1 ? 'navegando ao vivo' : 'navegando ao vivo'}</span>` : ''}
            ${c.purchased > 0 ? `<span style="color: #34d399; font-weight: 600;">${c.count > 0 ? '· ' : ''}${c.purchased} ${c.purchased === 1 ? 'compra' : 'compras'}</span>` : ''}
          </div>
        </div>`,
      },
    ]
  })

  // Três ondas dão contexto sem formar uma malha de movimento contínua.
  const topRinged = base.slice(0, MAX_AMBIENT_RINGS)
  const topMax = Math.max(1, ...topRinged.map((c) => (metric === 'sales' ? c.purchased : c.count)))
  const rings: GeoRing[] = topRinged.flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    const value = metric === 'sales' ? c.purchased : c.count
    return [{ lat: coords[0], lng: coords[1], intensity: value / topMax }]
  })

  // Fase 5: cada pulso de lead novo vira um anel temporário em intensidade
  // máxima (onda ampla e nítida). O TTL é gerido pelo pai (hero-globe) — quando
  // o pulso sai da lista, o anel some no próximo render.
  for (const p of pulses.slice(-2)) {
    const coords = COUNTRY_COORDS[p.code?.toUpperCase() ?? '']
    if (coords) rings.push({ lat: coords[0], lng: coords[1], intensity: 1 })
  }

  // Duas etiquetas bastam para orientar a leitura; o restante é explorável
  // pelo hover nos pontos.
  const labels: GeoLabel[] = base.slice(0, MAX_LABELS).flatMap((c) => {
    const coords = COUNTRY_COORDS[c.code?.toUpperCase() ?? '']
    if (!coords) return []
    let text = c.name
    if (metric === 'sales') {
      text = `${c.name} · ${c.purchased} ${c.purchased === 1 ? 'compra' : 'compras'}`
    } else if (metric === 'live') {
      text = `${c.name} · ${c.count} ao vivo`
    } else {
      const parts = []
      if (c.count > 0) parts.push(`${c.count} ao vivo`)
      if (c.purchased > 0) parts.push(`${c.purchased} ${c.purchased === 1 ? 'compra' : 'compras'}`)
      text = `${c.name}${parts.length ? ' · ' + parts.join(' · ') : ''}`
    }
    return [
      {
        lat: coords[0],
        lng: coords[1],
        text,
        size: 1.0,
      },
    ]
  })

  // No máximo três arcos: além disso, as linhas se cruzam e deixam de informar.
  const leader = base[0]
  const leaderCoords = leader ? COUNTRY_COORDS[leader.code?.toUpperCase() ?? ''] : null
  const arcs: GeoArc[] = leaderCoords
    ? base.slice(1, MAX_ARCS + 1).flatMap((c) => {
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
  return { totems, rings, arcs, labels }
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
  metric = 'all',
  pulses = [],
  showArcs = true,
  reducedMotion,
}: GlobePanelProps & {
  width: number
  height: number
  globeRef: React.MutableRefObject<any>
  reducedMotion: boolean
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

  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    const controls = g.controls()
    controls.autoRotate = !reducedMotion
    controls.enableZoom = true
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.zoomSpeed = 1.35
    controls.rotateSpeed = 0.9

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

    // Uma entrada curta dá sensação de profundidade uma única vez na sessão;
    // reduced-motion vai direto à posição final. Longitude -45 mostra
    // Europa e Brasil sem exigir interação inicial.
    if (!reducedMotion && firstGlobeEntryThisSession()) {
      g.pointOfView({ lat: 8, lng: -90, altitude: ALT_ENTRY }, 0)
      window.setTimeout(() => {
        globeRef.current?.pointOfView({ lat: 20, lng: -45, altitude: ALT_DEFAULT }, ENTRY_MS)
      }, 60)
    } else {
      g.pointOfView({ lat: 20, lng: -45, altitude: ALT_DEFAULT }, 0)
    }
    controls.autoRotateSpeed = SPIN_IDLE

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

    // Material refinado: contraste ótimo com relevo nítido e oceanos profundos
    try {
      const mat = g.globeMaterial?.()
      if (mat) {
        mat.emissive?.set?.('#020617')
        mat.emissiveIntensity = 0.05
        mat.shininess = 35
        mat.specular?.set?.('#0ea5e9')
      }
    } catch {
      /* material indisponível nesta versão */
    }

    // Iluminação refinada: contraste perfeito entre continentes e oceanos
    try {
      for (const light of g.lights()) {
        if (light.type === 'DirectionalLight') {
          light.intensity = 1.6
          light.color?.set?.('#ffffff')
        }
        if (light.type === 'AmbientLight') {
          light.intensity = 0.95
        }
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
  const { totems, rings, arcs, labels } = useMemo(
    () => buildPoints(countries, metric, pulses),
    [countries, metric, pulses],
  )

  // Sem presença ao vivo, os arcos somem (fade suave via arcsTransitionDuration).
  // Memoizado para manter identidade estável — trocar a referência a cada render
  // faria o three-globe reconstruir a camada de arcos continuamente.
  const visibleArcs = useMemo(() => (showArcs ? arcs : []), [showArcs, arcs])

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
      showAtmosphere
      atmosphereColor="#0ea5e9"
      atmosphereAltitude={0.14}
      /* Totens 3D verticais de pontos de acesso (Shopify Live View) */
      objectsData={totems}
      objectLat="lat"
      objectLng="lng"
      objectAltitude={0}
      objectFacesSurfaces={true}
      objectThreeObject={(d: object) => createTotemMesh(d as GeoTotem)}
      objectLabel="label"
      ringsData={rings}
      ringColor={() => (t: number) => metric === 'sales' ? `rgba(16,185,129,${(1 - t) * 0.55})` : `rgba(6,182,212,${(1 - t) * 0.55})`}
      ringMaxRadius={(d: object) => 1.3 + (d as GeoRing).intensity * 1.6}
      ringPropagationSpeed={0.8}
      ringRepeatPeriod={2500}
      labelsData={labels}
      labelLat="lat"
      labelLng="lng"
      labelText="text"
      labelSize="size"
      labelColor={() => 'rgba(255,255,255,0.95)'}
      labelDotRadius={0.32}
      labelAltitude={0.015}
      labelResolution={2}
      arcsData={visibleArcs}
      arcStartLat="startLat"
      arcStartLng="startLng"
      arcEndLat="endLat"
      arcEndLng="endLng"
      arcColor={() => ['rgba(37, 244, 238, 0.95)', 'rgba(52, 211, 153, 0.95)']}
      arcAltitudeAutoScale={0.32}
      arcStroke={0.45}
      arcDashLength={0.4}
      arcDashGap={0.6}
      arcDashAnimateTime={2000}
      arcsTransitionDuration={600}
    />
  )
}

/** Controles flutuantes refinados: zoom + / − / recentrar / pausar / tela cheia */
function GlobeControls({
  onZoomIn,
  onZoomOut,
  onRecenter,
  onTogglePause,
  isPaused,
  onFullscreen,
  isFullscreen,
}: {
  onZoomIn: () => void
  onZoomOut: () => void
  onRecenter: () => void
  onTogglePause: () => void
  isPaused: boolean
  onFullscreen: () => void
  isFullscreen: boolean
}) {
  return (
    <div className="absolute right-3 top-3 z-10 flex flex-col gap-1.5" data-tour="globe-controls">
      <button
        type="button"
        onClick={onZoomIn}
        className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-cyan-400/40 hover:bg-white/10 hover:text-white"
        aria-label="Aproximar"
      >
        <Plus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onZoomOut}
        className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-cyan-400/40 hover:bg-white/10 hover:text-white"
        aria-label="Afastar"
      >
        <Minus className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onRecenter}
        className="flex size-7 items-center justify-center rounded-lg border border-white/10 bg-black/40 text-white/70 backdrop-blur-md transition-all hover:border-cyan-400/40 hover:bg-white/10 hover:text-white"
        aria-label="Recentrar globo"
      >
        <Crosshair className="size-3.5" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onTogglePause}
        className={`flex size-7 items-center justify-center rounded-lg border backdrop-blur-md transition-all ${
          isPaused
            ? 'border-cyan-400 bg-cyan-400/20 text-cyan-300 shadow-[0_0_10px_rgba(37,244,238,0.25)]'
            : 'border-white/10 bg-black/40 text-white/70 hover:border-cyan-400/40 hover:bg-white/10 hover:text-white'
        }`}
        aria-label={isPaused ? 'Retomar rotação automática' : 'Pausar rotação'}
        title={isPaused ? 'Retomar rotação' : 'Pausar rotação'}
      >
        {isPaused ? (
          <Play className="size-3.5 fill-current" aria-hidden="true" />
        ) : (
          <Pause className="size-3.5 fill-current" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={onFullscreen}
        className="flex size-7 items-center justify-center rounded-lg border border-cyan-400/40 bg-black/40 text-white/80 shadow-[0_0_10px_rgba(37,244,238,0.15)] backdrop-blur-md transition-all hover:border-cyan-400 hover:bg-white/10 hover:text-white"
        aria-label={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
        aria-pressed={isFullscreen}
      >
        {isFullscreen ? (
          <Minimize2 className="size-3.5" aria-hidden="true" />
        ) : (
          <Maximize2 className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </div>
  )
}

/* Vinheta limpa e suave sem poluição visual */
function GlobeHud({ empty, note }: { empty?: boolean; note?: React.ReactNode }) {
  return (
    <>
      <span
        className="pointer-events-none absolute inset-0 z-[2]"
        aria-hidden="true"
        style={{
          background:
            'radial-gradient(ellipse 80% 75% at 50% 50%, transparent 60%, rgba(3, 4, 8, 0.55) 100%)',
        }}
      />
      {empty && note ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-10 flex justify-center">
          {note}
        </div>
      ) : null}
      <span className="globe-floor" aria-hidden="true" />
    </>
  )
}

function zoomBy(globeRef: React.MutableRefObject<any>, delta: number) {
  const g = globeRef.current
  if (!g) return
  const pov = g.pointOfView()
  // Escala exponencial suave e responsiva (zoom in aproxima 22%, zoom out afasta 26%)
  const altitude = delta < 0
    ? Math.max(ALT_MIN, pov.altitude * 0.78)
    : Math.min(ALT_MAX, pov.altitude * 1.26)
  g.pointOfView({ ...pov, altitude }, 240)
}

export default function GlobePanel({
  countries,
  focusCode,
  metric = 'all',
  pulses = [],
  showArcs = true,
  emptyNote,
}: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 320 })
  const resumeTimer = useRef<number | null>(null)
  const reducedMotion = useReducedMotion()
  const reducedMotionRef = useRef(reducedMotion)
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

  // Item 161: clique na tabela foca o globo no país com transição de escala e rotação suave
  useEffect(() => {
    if (!focusCode) return
    const coords = COUNTRY_COORDS[focusCode.toUpperCase()]
    const g = globeRef.current
    if (!coords || !g) return
    const pov = g.pointOfView()
    const targetAlt = Math.max(ALT_MIN, Math.min(1.42, pov.altitude))
    g.pointOfView({ lat: coords[0], lng: coords[1], altitude: targetAlt }, 650)
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

  useEffect(() => {
    reducedMotionRef.current = reducedMotion
    if (!reducedMotion) return
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    const globe = globeRef.current
    if (globe) globe.controls().autoRotate = false
  }, [reducedMotion])

  const [userPaused, setUserPaused] = useState(false)
  const userPausedRef = useRef(false)

  function togglePause() {
    const next = !userPaused
    setUserPaused(next)
    userPausedRef.current = next
    const g = globeRef.current
    if (!g) return
    if (next) {
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
      g.controls().autoRotate = false
    } else {
      g.controls().autoRotate = true
      g.controls().autoRotateSpeed = SPIN_IDLE
    }
  }

  // Interação contida: hover acelera levemente; arrastar pausa e só retoma
  // após quatro segundos sem ação.
  function setSpin(speed: number) {
    if (reducedMotion || userPausedRef.current) return
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotateSpeed = speed
  }
  function pauseSpin() {
    if (reducedMotion || userPausedRef.current) return
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = false
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => {
      if (reducedMotionRef.current || userPausedRef.current) return
      const g2 = globeRef.current
      if (!g2) return
      g2.controls().autoRotate = true
      g2.controls().autoRotateSpeed = SPIN_IDLE
    }, RESUME_AFTER_MS)
  }

  return (
    <div
      ref={containerRef}
      className="globe-stage relative h-full w-full overflow-hidden bg-[radial-gradient(ellipse_at_center,rgba(37,244,238,0.05)_0%,transparent_70%)]"
      data-tour="globe"
      role="region"
      aria-label={empty ? 'Globo de tráfego: aguardando dados' : `Globo de tráfego: ${countries.length} ${countries.length === 1 ? 'país ativo' : 'países ativos'}`}
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
          showArcs={showArcs}
          reducedMotion={reducedMotion}
        />
      )}
      <GlobeHud empty={empty} note={emptyNote} />
      <GlobeControls
        onZoomIn={() => zoomBy(globeRef, -ALT_STEP)}
        onZoomOut={() => zoomBy(globeRef, ALT_STEP)}
        onRecenter={() =>
          globeRef.current?.pointOfView({ lat: 20, lng: -45, altitude: ALT_DEFAULT }, 500)
        }
        onTogglePause={togglePause}
        isPaused={userPaused}
        onFullscreen={toggleFullscreen}
        isFullscreen={isFullscreen}
      />
    </div>
  )
}
