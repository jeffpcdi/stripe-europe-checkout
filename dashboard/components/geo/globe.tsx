'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import GlobeGL from 'react-globe.gl'
import * as THREE from 'three'
import { Crosshair, Maximize2, Minimize2, Minus, Plus, Play, Pause } from 'lucide-react'
import { useReducedMotion } from '@/lib/motion'
import { COUNTRY_COORDS } from '@/lib/country-coords'
import { countryName } from '@/lib/countries'

interface Country { code: string; name: string; count: number; purchased: number }
interface GlobePanelProps {
  countries: Country[]
  focusCode?: string | null
  pulseCodes?: string[]
  focusRevision?: number
  children?: ReactNode
}

const ALT_DEFAULT = 1.85
const ALT_MIN = 1.35
const ALT_MAX = 3.4
const SPIN = 0.3
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

/** Um único canvas; presença vem exclusivamente do snapshot ao vivo validado pelo pai. */
export default function GlobePanel({ countries, focusCode, focusRevision, pulseCodes = [], children }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [ready, setReady] = useState(false)
  const material = useMemo(() => new THREE.MeshPhongMaterial({ shininess: 8, specular: '#4b7184' }), [])
  useEffect(() => () => { material.map?.dispose(); material.bumpMap?.dispose(); material.dispose() }, [material])
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

  const points = useMemo(() => countries.flatMap(country => {
    const coords = COUNTRY_COORDS[country.code]
    if (!coords || country.count <= 0) return []
    const name = countryName(country.code)
    return [{ lat: coords[0], lng: coords[1], code: country.code,
      label: `<div class="presence-tooltip"><strong>${escapeHtml(name)}</strong><span>${country.count} ${country.count === 1 ? 'visitante online' : 'visitantes online'}</span></div>` }]
  }), [countries])
  const rings = useMemo(() => reduced || paused ? [] : points.filter(point => pulseCodes.includes(point.code)), [points, pulseCodes, reduced, paused])

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
    // Luz difusa preenche o lado oposto; evita continentes pretos durante a rotação.
    const fill = new THREE.AmbientLight('#ffffff', 2.2)
    const key = new THREE.DirectionalLight('#e7f6ff', 1.7)
    key.position.set(-120, 100, 180)
    globe.lights([fill, key])
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

  // Captura o renderer antes que o React remova a ref ao desmontar.
  useEffect(() => {
    if (!ready) return
    const renderer = globeRef.current?.renderer()
    return () => { renderer?.dispose(); renderer?.forceContextLoss() }
  }, [ready])

  function moveCamera(delta?: number) {
    const globe = globeRef.current
    if (!globe) return
    const pov = globe.pointOfView()
    globe.pointOfView(delta === undefined ? { lat: 8, lng: -48, altitude: ALT_DEFAULT } : {
      ...pov, altitude: Math.max(ALT_MIN, Math.min(ALT_MAX, pov.altitude + delta)),
    }, reduced ? 0 : 350)
  }
  async function toggleFullscreen() {
    try {
      setFullscreenError(false)
      if (fullscreen) await document.exitFullscreen()
      else await containerRef.current?.requestFullscreen()
    } catch { setFullscreenError(true) }
  }

  return (
    <div ref={containerRef} className="presence-stage" role="region" aria-label="Globo de visitantes online" data-ready={ready}>
      <div className="presence-sky" aria-hidden="true" />
      <div className="presence-orbit presence-orbit-outer" aria-hidden="true" />
      <div className="presence-orbit presence-orbit-inner" aria-hidden="true" />
      <div className="presence-canvas">
        {size.width > 0 && <GlobeGL ref={globeRef} width={size.width} height={Math.max(120, size.height - 214)}
          onGlobeReady={onReady} globeMaterial={material} backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="/dashboard/textures/earth-blue-marble.jpg"
          bumpImageUrl="/dashboard/textures/earth-topology.png"
          showAtmosphere atmosphereColor="#6bcbe7" atmosphereAltitude={0.14}
          pointsData={points} pointLat="lat" pointLng="lng" pointAltitude={0.002}
          pointRadius={0.5} pointResolution={24} pointColor={() => '#6ffff5'} pointLabel="label"
          pointsTransitionDuration={0}
          ringsData={rings} ringLat="lat" ringLng="lng" ringAltitude={0.003}
          ringColor={() => (t: number) => `rgba(103,255,241,${(1 - t) * 0.7})`}
          ringMaxRadius={3} ringPropagationSpeed={1.3} ringRepeatPeriod={0}
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
        {fullscreenSupported && <><span className="presence-control-divider" aria-hidden="true" /><button type="button" onClick={toggleFullscreen} aria-label={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} title={fullscreen ? 'Sair da tela cheia' : 'Tela cheia'} aria-pressed={fullscreen}>{fullscreen ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button></>}
      </div>
      {fullscreenError && <p className="presence-control-error" role="status">Tela cheia indisponível neste navegador.</p>}
    </div>
  )
}
