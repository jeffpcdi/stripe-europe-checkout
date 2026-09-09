'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import GlobeGL from 'react-globe.gl'
import * as THREE from 'three'
import { Crosshair, Maximize2, Minimize2, Minus, Plus, Play, Pause, Zap, RefreshCw } from 'lucide-react'
import { useReducedMotion } from '@/lib/motion'
import { useModalA11y } from '@/lib/use-modal-a11y'
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

const ALT_DEFAULT = 1.6
const ALT_MIN = 1.35
const ALT_MAX = 6
const SPIN = 0.3
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Um único canvas; presença vem exclusivamente do snapshot ao vivo validado pelo pai. */
export default function GlobePanel({ countries, focusCode, focusRevision, pulseCodes = [], onSimulateLead, children }: GlobePanelProps) {
  const containerRef = useRef<HTMLDialogElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const sizeRef = useRef(size)
  sizeRef.current = size
  const fittedAltitude = useCallback(() => {
    const { width, height } = sizeRef.current
    const fov = globeRef.current?.camera().fov || 50
    const ratio = height / Math.max(1, Math.min(width, height))
    return Math.max(ALT_DEFAULT, Math.sqrt(1 + (ratio / (Math.tan(fov * Math.PI / 360) * 0.88)) ** 2) - 1)
  }, [])
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
  const [inAppFullscreen, setInAppFullscreen] = useState(false)
  const isImmersive = inAppFullscreen
  const transitionRef = useRef<Animation | null>(null)
  const fullscreenTrigger = useRef<HTMLElement | null>(null)
  const originClip = useRef('inset(8% 8% 8% 8% round 20px)')
  const closing = useRef(false)
  const closeFullscreen = useCallback(() => {
    if (closing.current) return
    const dialog = containerRef.current
    transitionRef.current?.cancel()
    if (!dialog || motion.current.reduced) { setInAppFullscreen(false); return }
    closing.current = true
    const animation = dialog.animate([
      { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 },
      { clipPath: originClip.current, opacity: 0.3 },
    ], { duration: 300, easing: 'cubic-bezier(.4,0,.2,1)', fill: 'forwards' })
    transitionRef.current = animation
    animation.finished.then(() => {
      setInAppFullscreen(false)
      closing.current = false
    }).catch(() => { closing.current = false })
  }, [])
  useModalA11y(inAppFullscreen, containerRef, closeFullscreen)
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
      globeRef.current.pointOfView({ lat: coords[0], lng: coords[1], altitude: fittedAltitude() }, reduced ? 0 : 700)
    }
  }, [reduced, fittedAltitude])

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
      tag.textContent = 'Novo'
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
    const el = canvasRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: Math.round(entry.contentRect.width), height: Math.round(entry.contentRect.height) }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // A abertura revela o espaço a partir do card sem esticar o canvas.
  useLayoutEffect(() => {
    const dialog = containerRef.current
    if (!dialog) return
    if (!inAppFullscreen && !dialog.matches(':modal')) return
    const previousFocus = document.activeElement as HTMLElement | null
    dialog.close()
    transitionRef.current?.cancel()
    if (inAppFullscreen) {
      dialog.showModal()
      if (!motion.current.reduced) {
        transitionRef.current = dialog.animate([
          { clipPath: originClip.current, opacity: 0.45 },
          { clipPath: 'inset(0% 0% 0% 0% round 0px)', opacity: 1 },
        ], { duration: 640, easing: 'cubic-bezier(.16,1,.3,1)' })
      }
    } else { dialog.show(); previousFocus?.focus({ preventScroll: true }) }
  }, [inAppFullscreen])

  useEffect(() => () => { transitionRef.current?.cancel() }, [])

  // showModal move o foco antes do efeito compartilhado; guardamos o botão de origem.
  useEffect(() => {
    if (!inAppFullscreen && fullscreenTrigger.current) {
      fullscreenTrigger.current.focus({ preventScroll: true })
      fullscreenTrigger.current = null
    }
  }, [inAppFullscreen])

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
    const rim = new THREE.DirectionalLight('#d7e8ef', 0.35)
    rim.position.set(120, -70, -140)
    globe.lights([fill, key, rim])
    if (!cameraInitialized.current) {
      const coords = initialFocus.current ? COUNTRY_COORDS[initialFocus.current] : undefined
      globe.pointOfView({ lat: coords?.[0] ?? 8, lng: coords?.[1] ?? -48, altitude: fittedAltitude() }, 0)
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
    if (coords) globeRef.current?.pointOfView({ lat: coords[0], lng: coords[1], altitude: fittedAltitude() }, reduced ? 0 : 700)
  }, [focusCode, focusRevision, ready, reduced, fittedAltitude])

  useEffect(() => {
    if (!ready || !globeRef.current) return
    globeRef.current.pointOfView({ ...globeRef.current.pointOfView(), altitude: fittedAltitude() }, 0)
  }, [size.width, size.height, ready, fittedAltitude])

  // react-globe.gl já libera o renderer ao desmontar. Forçar a perda de
  // contexto aqui também destrói o canvas durante a repetição dos efeitos.

  function moveCamera(delta?: number) {
    const globe = globeRef.current
    if (!globe) return
    const pov = globe.pointOfView()
    globe.pointOfView(delta === undefined ? { lat: 8, lng: -48, altitude: fittedAltitude() } : {
      ...pov, altitude: Math.max(ALT_MIN, Math.min(ALT_MAX, pov.altitude + delta)),
    }, reduced ? 0 : 350)
  }

  function toggleFullscreen() {
    if (inAppFullscreen) { closeFullscreen(); return }
    fullscreenTrigger.current = document.activeElement as HTMLElement | null
    const rect = containerRef.current?.getBoundingClientRect()
    if (rect) {
      const width = window.innerWidth, height = window.innerHeight
      const clamp = (n: number, max: number) => Math.max(0, Math.min(max, n))
      originClip.current = `inset(${clamp(rect.top, height) / height * 100}% ${clamp(width - rect.right, width) / width * 100}% ${clamp(height - rect.bottom, height) / height * 100}% ${clamp(rect.left, width) / width * 100}% round 20px)`
    }
    setInAppFullscreen(true)
  }

  return (
    <dialog open
      ref={containerRef}
      onCancel={(event) => { event.preventDefault(); closeFullscreen() }}
      tabIndex={-1}
      className={`presence-stage ${isImmersive ? 'presence-stage-immersive' : ''}`}
      role={isImmersive ? 'dialog' : 'region'}
      aria-modal={isImmersive || undefined}
      aria-label="Globo de visitantes online"
      data-ready={ready}
      data-immersive={isImmersive}
      data-in-app-fullscreen={inAppFullscreen}
    >
      {/* HUD Imersivo no topo durante Fullscreen */}
      {isImmersive && (
        <div className="presence-fullscreen-topbar">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand-cyan opacity-50" />
              <span className="relative inline-flex size-2.5 rounded-full bg-brand-cyan" />
            </span>
            <span className="text-xs font-semibold text-foreground">
              Visitantes ao vivo
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
            <span>Fechar</span>
          </button>
        </div>
      )}

      <div className="presence-sky" aria-hidden="true" />
      <div className="presence-star-depth" aria-hidden="true" />
      <div className="presence-blackhole" aria-hidden="true"
        style={{ '--horizon-size': `${Math.min(size.width, size.height) * 1.2}px` } as CSSProperties}>
        <div className="presence-blackhole-lens" />
        <div className="presence-blackhole-disc" />
      </div>
      <div ref={canvasRef} className="presence-canvas">
        {size.width > 0 && <GlobeGL key={attempt} ref={globeRef} width={size.width} height={Math.max(1, size.height)}
          onGlobeReady={onReady} globeMaterial={material} backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-blue-marble.jpg'}
          bumpImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-topology.png'}
          showGraticules={textureFailed}
          showAtmosphere atmosphereColor="#a2bacb" atmosphereAltitude={0.085}
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
          className="presence-expand"
          onClick={toggleFullscreen}
          aria-label={isImmersive ? 'Sair da tela cheia' : 'Tela cheia'}
          title={isImmersive ? 'Sair da tela cheia' : 'Tela cheia'}
          aria-pressed={isImmersive}
        >
          {isImmersive ? <Minimize2 size={17} /> : <Maximize2 size={17} />}<span>{isImmersive ? 'Fechar' : 'Ampliar'}</span>
        </button>
      </div>
      {textureFailed && <p className="presence-control-error" role="status">Mapa simplificado · imagem indisponível <button type="button" className="presence-retry" onClick={() => { cameraInitialized.current = false; setReady(false); setTextureFailed(false); setAttempt(value => value + 1) }}><RefreshCw size={13} />Recarregar imagem</button></p>}
    </dialog>
  )
}
