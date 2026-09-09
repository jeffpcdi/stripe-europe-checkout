'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import GlobeGL from 'react-globe.gl'
import * as THREE from 'three'
import { Crosshair, Maximize2, Minimize2, Minus, Plus, Play, Pause, Zap, RefreshCw } from 'lucide-react'
import { useReducedMotion } from '@/lib/motion'
import { COUNTRY_COORDS } from '@/lib/country-coords'
import { countryName } from '@/lib/countries'
import { countryFlag } from '@/lib/format'

interface Country { code: string; name: string; count: number; purchased: number }
interface GlobePanelProps {
  countries: Country[]
  focusCode?: string | null
  pulseCodes?: string[]
  focusRevision?: number
  onSimulateLead?: () => void
  children?: ReactNode
}

const ALT_DEFAULT = 1.85
const ALT_MIN = 1.35
const ALT_MAX = 3.4
const SPIN = 0.3
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Um único canvas; presença vem exclusivamente do snapshot ao vivo validado pelo pai. */
export default function GlobePanel({ countries, focusCode, focusRevision, pulseCodes = [], onSimulateLead, children }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [ready, setReady] = useState(false)
  const [textureFailed, setTextureFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const material = useMemo(() => new THREE.MeshPhongMaterial({ shininess: 20, specular: '#1d384d' }), [attempt])
  useEffect(() => () => { material.map?.dispose(); material.bumpMap?.dispose(); material.dispose() }, [material])
  useEffect(() => {
    if (textureFailed && !material.map) {
      material.color = new THREE.Color('#173f52')
      material.needsUpdate = true
    }
  }, [textureFailed, material])
  const [paused, setPaused] = useState(false)
  const [fullscreen, setFullscreen] = useState(false)
  const [fullscreenError, setFullscreenError] = useState(false)
  const [fullscreenSupported, setFullscreenSupported] = useState(false)
  const reduced = useReducedMotion()
  const motion = useRef({ reduced, paused })
  motion.current = { reduced, paused }
  const initialFocus = useRef(focusCode)
  const cameraInitialized = useRef(false)
  const dragging = useRef(false)
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // A biblioteca não emite onGlobeReady quando a imagem falha. Libera uma
  // esfera simples após o prazo, mantendo a presença e os controles utilizáveis.
  useEffect(() => {
    if (!size.width || ready) return
    const timer = setTimeout(() => setTextureFailed(true), 10_000)
    return () => clearTimeout(timer)
  }, [size.width, ready])

  const maxCount = useMemo(() => {
    return countries.reduce((max, c) => Math.max(max, c.count), 1)
  }, [countries])

  const totalVisitors = useMemo(() => {
    return countries.reduce((sum, c) => sum + c.count, 0)
  }, [countries])

  const onMarkerClick = useCallback((d: any) => {
    if (!d?.code || !globeRef.current) return
    const coords = COUNTRY_COORDS[d.code]
    if (coords) {
      globeRef.current.pointOfView({ lat: coords[0], lng: coords[1], altitude: ALT_DEFAULT }, reduced ? 0 : 700)
    }
  }, [reduced])

  // Marcadores HTML elegantes e nítidos projetados no espaço 3D
  // Substitui rótulos de texto cru e cilindros negros por badges glassmorphism com bandeiras e pulso vivo
  const htmlMarkers = useMemo(() => {
    const list: any[] = []
    for (const country of countries) {
      const coords = COUNTRY_COORDS[country.code]
      if (!coords || country.count <= 0) continue
      const isPulse = pulseCodes.includes(country.code)
      list.push({
        lat: coords[0],
        lng: coords[1],
        code: country.code,
        name: countryName(country.code),
        flag: countryFlag(country.code),
        count: country.count,
        isPulse,
        altitude: 0.034,
      })
    }
    return list
  }, [countries, pulseCodes])

  const createMarkerElement = useCallback((d: any) => {
    const wrapper = document.createElement('div')
    wrapper.className = 'globe-marker-wrapper'

    const content = document.createElement('div')
    content.className = `globe-marker-content ${d.isPulse ? 'is-pulse' : ''}`
    content.setAttribute('data-code', d.code)

    // Sonar radar ondulatório
    const sonar = document.createElement('div')
    sonar.className = 'globe-marker-sonar'
    content.appendChild(sonar)

    // Haste de luz que conecta o terreno ao card flutuante
    const stem = document.createElement('div')
    stem.className = 'globe-marker-stem'
    content.appendChild(stem)

    // Card flutuante estilo Glassmorphism
    const badge = document.createElement('div')
    badge.className = 'globe-marker-badge'
    badge.setAttribute('title', `${d.name} (${d.code}) • ${d.count} visitante(s) online agora`)

    const flag = document.createElement('span')
    flag.className = 'globe-marker-flag'
    flag.textContent = d.flag || '🌐'
    badge.appendChild(flag)

    const code = document.createElement('span')
    code.className = 'globe-marker-code'
    code.textContent = d.code
    badge.appendChild(code)

    const count = document.createElement('span')
    count.className = 'globe-marker-count'
    count.textContent = String(d.count)
    badge.appendChild(count)

    if (d.isPulse) {
      const tag = document.createElement('span')
      tag.className = 'globe-marker-tag'
      tag.textContent = '⚡ NOVO LEAD'
      badge.appendChild(tag)
    }

    content.appendChild(badge)

    // Clique centraliza a visualização
    content.addEventListener('click', (e) => {
      e.stopPropagation()
      onMarkerClick({ code: d.code })
    })

    wrapper.appendChild(content)
    return wrapper
  }, [onMarkerClick])

  // Pontos de luz rente ao solo do globo e anéis de sonar radar
  const { points, rings } = useMemo(() => {
    const pts: any[] = []
    const rgs: any[] = []

    for (const country of countries) {
      const coords = COUNTRY_COORDS[country.code]
      if (!coords || country.count <= 0) continue
      const name = countryName(country.code)
      const flag = countryFlag(country.code)
      const isPulse = pulseCodes.includes(country.code)
      const rel = Math.max(0.15, Math.min(1, country.count / maxCount))

      let beaconColor = '#25f4ee'
      let ringRgb = '37, 244, 238'
      if (isPulse || rel >= 0.6 || country.count >= 4) {
        beaconColor = '#fe2c55'
        ringRgb = '254, 44, 85'
      } else if (rel >= 0.3 || country.count >= 2) {
        beaconColor = '#ff8800'
        ringRgb = '255, 136, 0'
      }

      const tooltip = `<div class="presence-tooltip">
        <div class="presence-tooltip-header">
          <span class="presence-tooltip-flag">${flag}</span>
          <strong>${escapeHtml(name)}</strong>
          <span class="presence-tooltip-code">${country.code}</span>
        </div>
        <div class="presence-tooltip-stat">
          <span class="presence-tooltip-dot" style="background:${beaconColor};box-shadow:0 0 12px ${beaconColor}"></span>
          <span class="presence-tooltip-count" style="color:${beaconColor}">${country.count}</span>
          <span class="presence-tooltip-label">${country.count === 1 ? 'visitante online agora' : 'visitantes online agora'}</span>
        </div>
        ${isPulse ? '<div class="presence-tooltip-lead-alert">⚡ NOVO LEAD DETECTADO</div>' : ''}
      </div>`

      // 1. Ponto luminoso no terreno (flat contra a curvatura, sem extrusão de cilindro negro)
      pts.push({
        lat: coords[0],
        lng: coords[1],
        code: country.code,
        count: country.count,
        altitude: 0.005,
        radius: isPulse ? 1.4 : 0.85,
        color: isPulse ? '#fe2c55' : beaconColor,
        label: tooltip,
      })

      // 2. Núcleo branco puro de luminância máxima (hot core)
      pts.push({
        lat: coords[0],
        lng: coords[1],
        code: country.code,
        count: country.count,
        altitude: 0.008,
        radius: isPulse ? 0.65 : 0.35,
        color: '#ffffff',
        label: tooltip,
      })

      // 3. Anéis de pulso de radar contínuos e de alta resolução
      if (!reduced && !paused) {
        rgs.push({
          lat: coords[0],
          lng: coords[1],
          code: country.code,
          ringColor: (t: number) => {
            const alpha = Math.max(0, (1 - t) * (isPulse ? 0.98 : 0.78))
            return isPulse ? `rgba(254, 44, 85, ${alpha})` : `rgba(${ringRgb}, ${alpha})`
          },
          ringMaxRadius: isPulse ? 9.2 : (3.6 + rel * 3.8),
          ringPropagationSpeed: isPulse ? 3.4 : 1.45,
          ringRepeatPeriod: isPulse ? 720 : 1450,
        })
      }
    }

    return { points: pts, rings: rgs }
  }, [countries, maxCount, pulseCodes, reduced, paused])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    setFullscreenSupported(Boolean(document.fullscreenEnabled && el.requestFullscreen))
    const onFullscreen = () => setFullscreen(document.fullscreenElement === el)
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', onFullscreen) }
  }, [])

  const onReady = useCallback(() => {
    const globe = globeRef.current
    if (!globe) return
    const controls = globe.controls()
    controls.enableZoom = false // A roda continua rolando a página.
    controls.enablePan = false
    controls.enableDamping = true
    controls.dampingFactor = 0.07
    controls.rotateSpeed = 0.55
    controls.autoRotateSpeed = SPIN
    controls.autoRotate = !motion.current.reduced && !motion.current.paused
    globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
    // Luz ambiente calibrada para preservar alto contraste dos oceanos e continentes; rim light ciano na borda
    const fill = new THREE.AmbientLight('#ffffff', 0.95)
    const key = new THREE.DirectionalLight('#ffffff', 1.85)
    key.position.set(-120, 100, 180)
    const rim = new THREE.DirectionalLight('#25f4ee', 0.85)
    rim.position.set(120, -70, -140)
    globe.lights([fill, key, rim])
    if (!cameraInitialized.current) {
      const coords = initialFocus.current ? COUNTRY_COORDS[initialFocus.current] : undefined
      globe.pointOfView({ lat: coords?.[0] ?? 8, lng: coords?.[1] ?? -48, altitude: ALT_DEFAULT }, 0)
      cameraInitialized.current = true
    }
    setReady(true)
  }, [])

  useEffect(() => {
    if (!ready) return
    const globe = globeRef.current
    if (!globe) return
    let visible = true
    const renderVisibility = () => {
      if (document.hidden || !visible) globe.pauseAnimation()
      else globe.resumeAnimation()
    }
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; renderVisibility() }, { threshold: 0.05 })
    observer.observe(containerRef.current!)
    document.addEventListener('visibilitychange', renderVisibility)
    const controls = globe.controls()
    const start = () => {
      dragging.current = true
      controls.autoRotate = false
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
    const end = () => {
      dragging.current = false
      resumeTimer.current = setTimeout(() => { controls.autoRotate = !motion.current.paused && !motion.current.reduced }, 4000)
    }
    controls.addEventListener('start', start)
    controls.addEventListener('end', end)
    renderVisibility()
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', renderVisibility)
      controls.removeEventListener('start', start)
      controls.removeEventListener('end', end)
      if (resumeTimer.current) clearTimeout(resumeTimer.current)
    }
  }, [ready])

  useEffect(() => {
    if (ready && globeRef.current) globeRef.current.controls().autoRotate = !paused && !reduced && !dragging.current
  }, [paused, reduced, ready])

  useEffect(() => {
    if (!ready || !focusCode) return
    const coords = COUNTRY_COORDS[focusCode]
    if (coords) globeRef.current?.pointOfView({ lat: coords[0], lng: coords[1], altitude: ALT_DEFAULT }, reduced ? 0 : 700)
  }, [focusCode, focusRevision, ready, reduced])

  // react-globe.gl já libera o renderer ao desmontar. Forçar a perda de
  // contexto aqui também destrói o canvas durante a repetição dos efeitos.

  const [inAppFullscreen, setInAppFullscreen] = useState(false)
  const isImmersive = fullscreen || inAppFullscreen

  function moveCamera(delta?: number) {
    const globe = globeRef.current
    if (!globe) return
    const pov = globe.pointOfView()
    globe.pointOfView(delta === undefined ? { lat: 8, lng: -48, altitude: ALT_DEFAULT } : {
      ...pov, altitude: Math.max(ALT_MIN, Math.min(ALT_MAX, pov.altitude + delta)),
    }, reduced ? 0 : 350)
  }

  // Tecla ESC para sair de tela cheia in-app
  useEffect(() => {
    if (!inAppFullscreen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInAppFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inAppFullscreen])

  async function toggleFullscreen() {
    try {
      setFullscreenError(false)
      if (inAppFullscreen) {
        setInAppFullscreen(false)
        return
      }
      if (fullscreen) {
        if (document.fullscreenElement) {
          await document.exitFullscreen()
        }
      } else {
        if (containerRef.current?.requestFullscreen) {
          try {
            await containerRef.current.requestFullscreen()
          } catch {
            // Em caso de restrição do iframe (ex: sandbox sem allow-fullscreen), ativa o modo in-app
            setInAppFullscreen(true)
          }
        } else {
          setInAppFullscreen(true)
        }
      }
    } catch {
      setInAppFullscreen(true)
    }
  }

  return (
    <div
      ref={containerRef}
      className={`presence-stage transition-all duration-500 ease-out ${isImmersive ? 'presence-stage-immersive' : ''}`}
      role="region"
      aria-label="Globo de visitantes online"
      data-ready={ready}
      data-immersive={isImmersive}
      data-in-app-fullscreen={inAppFullscreen}
    >
      {/* HUD Imersivo no topo durante Fullscreen */}
      {isImmersive && (
        <div className="presence-fullscreen-topbar anim-pop-in">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
            <span className="text-xs font-bold tracking-widest text-white uppercase font-mono">
              RADAR GLOBAL AO VIVO
            </span>
            <span className="hidden sm:inline-block h-3 w-px bg-white/20" />
            <span className="hidden sm:inline-block text-xs text-slate-300">
              {totalVisitors} visitante{totalVisitors === 1 ? '' : 's'} monitorados em tempo real
            </span>
          </div>
          <button
            type="button"
            onClick={toggleFullscreen}
            className="presence-fullscreen-exit-btn"
            title="Sair da tela cheia (ESC)"
            aria-label="Sair da tela cheia"
          >
            <Minimize2 size={14} />
            <span>Sair (ESC)</span>
          </button>
        </div>
      )}

      <div className="presence-sky" aria-hidden="true" />
      <div className="presence-orbit presence-orbit-outer" aria-hidden="true" />
      <div className="presence-orbit presence-orbit-inner" aria-hidden="true" />
      <div className="presence-canvas">
        {size.width > 0 && <GlobeGL key={attempt} ref={globeRef} width={size.width} height={Math.max(120, size.height - (isImmersive ? 140 : 214))}
          onGlobeReady={onReady} globeMaterial={material} backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-blue-marble.jpg'}
          bumpImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-topology.png'}
          showGraticules={textureFailed}
          showAtmosphere atmosphereColor="#25f4ee" atmosphereAltitude={0.18}
          htmlElementsData={htmlMarkers}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude="altitude"
          htmlElement={createMarkerElement}
          htmlTransitionDuration={250}
          pointsData={points} pointLat="lat" pointLng="lng"
          pointAltitude={(d: any) => d.altitude}
          pointRadius={(d: any) => d.radius}
          pointResolution={36}
          pointColor={(d: any) => d.color}
          pointLabel="label"
          pointsTransitionDuration={0}
          onPointClick={onMarkerClick}
          ringsData={rings} ringLat="lat" ringLng="lng" ringAltitude={0.014}
          ringColor={(d: any) => d.ringColor}
          ringMaxRadius={(d: any) => d.ringMaxRadius}
          ringPropagationSpeed={(d: any) => d.ringPropagationSpeed}
          ringRepeatPeriod={(d: any) => d.ringRepeatPeriod}
          ringResolution={64}
        />}
      </div>
      {!ready && <div className="presence-loading" role="status"><span />Preparando o globo…</div>}
      {children}
      <div className="presence-controls" role="group" aria-label="Controles do globo">
        <button type="button" onClick={() => moveCamera(-0.3)} aria-label="Aproximar" title="Aproximar" disabled={!ready}><Plus size={17} /></button>
        <button type="button" onClick={() => moveCamera(0.3)} aria-label="Afastar" title="Afastar" disabled={!ready}><Minus size={17} /></button>
        <span className="presence-control-divider" aria-hidden="true" />
        <button type="button" onClick={() => moveCamera()} aria-label="Recentrar globo" title="Recentrar globo" disabled={!ready}><Crosshair size={17} /></button>
        <button type="button" className="presence-rotation" onClick={() => setPaused(!paused)} disabled={!ready || reduced}
          aria-pressed={paused || reduced} aria-label={paused ? 'Retomar rotação automática' : 'Pausar rotação'} title={reduced ? 'Movimento reduzido ativado' : paused ? 'Retomar rotação' : 'Pausar rotação'}>
          {paused || reduced ? <Play size={15} /> : <Pause size={15} />}<span>{paused || reduced ? 'Pausado' : 'Girando'}</span>
        </button>
        {onSimulateLead && (
          <>
            <span className="presence-control-divider" aria-hidden="true" />
            <button
              type="button"
              className="presence-simulate-btn"
              onClick={onSimulateLead}
              disabled={!ready}
              title="Simular entrada de lead para testar o efeito no globo"
              aria-label="Simular entrada de lead"
            >
              <Zap size={14} className="text-[#fe2c55]" />
              <span>Simular lead</span>
            </button>
          </>
        )}
        <span className="presence-control-divider" aria-hidden="true" />
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label={isImmersive ? 'Sair da tela cheia' : 'Tela cheia'}
          title={isImmersive ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-pressed={isImmersive}
        >
          {isImmersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}
        </button>
      </div>
      {fullscreenError && <p className="presence-control-error" role="status">Tela cheia indisponível neste navegador.</p>}
      {textureFailed && <p className="presence-control-error" role="status">Mapa simplificado · imagem indisponível <button type="button" className="presence-retry" onClick={() => { cameraInitialized.current = false; setReady(false); setTextureFailed(false); setAttempt(value => value + 1) }}><RefreshCw size={13} />Recarregar imagem</button></p>}
    </div>
  )
}
