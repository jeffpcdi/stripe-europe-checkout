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
interface GlobeShaderSource { fragmentShader: string }
interface GlobeTexture {
  dispose: () => void
  colorSpace: unknown
  minFilter: unknown
  magFilter: unknown
  generateMipmaps: boolean
  anisotropy: number
  needsUpdate: boolean
}
interface GlobePanelProps {
  countries: Country[]
  focusCode?: string | null
  pulseCodes?: string[]
  focusRevision?: number
  onSimulateLead?: () => void
  children?: ReactNode
}

const ALT_DEFAULT = 1.5
const ALT_MIN = 1.35
const ALT_MAX = 6
const SPIN = 0.38
const FEATURED_COUNTRY_LABELS = new Set(['BR', 'MX', 'CL'])
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

function angularDistanceDegrees(a: [number, number], b: [number, number]) {
  const toRad = Math.PI / 180
  const lat1 = a[0] * toRad
  const lat2 = b[0] * toRad
  const deltaLng = (b[1] - a[1]) * toRad
  const cosine = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(deltaLng)
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / toRad
}

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
    return Math.max(ALT_DEFAULT, Math.sqrt(1 + (ratio / (Math.tan(fov * Math.PI / 360) * 0.95)) ** 2) - 1)
  }, [])
  const [ready, setReady] = useState(false)
  const [textureFailed, setTextureFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const material = useMemo(() => {
    const earth = new THREE.MeshStandardMaterial({
      // Base clara preserva oceanos, nuvens e continentes sob a iluminação da cena.
      color: '#e1edf5',
      roughness: 0.78,
      metalness: 0.02,
      envMapIntensity: 0.24,
      bumpScale: 0.34,
      emissive: '#000000',
      emissiveIntensity: 0,
      dithering: true,
    })

    // Transição dia/noite suave, com relevo legível também no hemisfério escuro.
    earth.onBeforeCompile = (shader: GlobeShaderSource) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#if NUM_DIR_LIGHTS > 0
  float roiSunFacing = dot(normal, directionalLights[0].direction);
  float roiDaylight = smoothstep(-0.34, 0.30, roiSunFacing);
  float roiNightMask = 1.0 - smoothstep(-0.16, 0.20, roiSunFacing);
  vec3 roiNightGrade = vec3(0.60, 0.70, 0.84);
  vec3 roiDayGrade = vec3(1.02, 1.03, 1.05);
  diffuseColor.rgb *= mix(roiNightGrade, roiDayGrade, roiDaylight);
  totalEmissiveRadiance *= roiNightMask;
#endif`,
      )
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
#if NUM_DIR_LIGHTS > 0
{
  vec3 roiViewDir = normalize(vViewPosition);
  float roiFresnel = pow(clamp(1.0 - abs(dot(normal, roiViewDir)), 0.0, 1.0), 4.6);
  float roiSunFacing = dot(normal, directionalLights[0].direction);
  float roiRimMask = smoothstep(-0.26, 0.12, roiSunFacing);
  float roiTwilight = smoothstep(-0.30, 0.04, roiSunFacing) - smoothstep(0.05, 0.28, roiSunFacing);
  vec3 roiAtmosphere = vec3(0.18, 0.66, 0.92) * roiFresnel * roiRimMask * 0.18;
  vec3 roiTwilightLift = vec3(0.05, 0.12, 0.18) * roiTwilight * roiFresnel * 0.42;
  gl_FragColor.rgb += roiAtmosphere + roiTwilightLift;
}
#endif`,
      )
    }
    earth.customProgramCacheKey = () => 'roi-nados-earth-daylight-v1'
    return earth
  }, [attempt])

  // O asset noturno 4K já existe no projeto. Ele é usado como emissive map
  // para preservar clusters urbanos reais e contraste quente/frio.
  useEffect(() => {
    let cancelled = false
    const loader = new THREE.TextureLoader()
    loader.load(
      '/dashboard/textures/earth-night.jpg',
      (nightMap: GlobeTexture) => {
        if (cancelled) { nightMap.dispose(); return }
        nightMap.colorSpace = THREE.SRGBColorSpace
        nightMap.minFilter = THREE.LinearMipmapLinearFilter
        nightMap.magFilter = THREE.LinearFilter
        nightMap.generateMipmaps = true
        const renderer = globeRef.current?.renderer?.()
        nightMap.anisotropy = renderer ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4
        nightMap.needsUpdate = true
        material.emissiveMap = nightMap
        material.emissive.set('#efb76f')
        material.emissiveIntensity = 0.48
        material.needsUpdate = true
      },
      undefined,
      () => {
        // Falha da textura noturna não invalida a textura diurna nem o fallback.
      },
    )
    return () => {
      cancelled = true
      material.emissiveMap?.dispose()
      material.emissiveMap = null
    }
  }, [material])

  useEffect(() => () => {
    material.map?.dispose()
    material.bumpMap?.dispose()
    material.emissiveMap?.dispose()
    material.dispose()
  }, [material])

  useEffect(() => {
    if (textureFailed && !material.map) {
      material.color = new THREE.Color('#1d3d4c')
      material.emissiveMap = null
      material.emissive.set('#02090e')
      material.emissiveIntensity = 0.10
      material.roughness = 0.9
      material.metalness = 0.02
      material.needsUpdate = true
    }
  }, [textureFailed, material])
  const [paused, setPaused] = useState(false)
  const [hoveredCountry, setHoveredCountry] = useState<string | null>(null)
  const [hoveredRouteKey, setHoveredRouteKey] = useState<string | null>(null)
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

  const setHoveredCountrySafe = useCallback((code: string | null) => {
    setHoveredCountry(previous => previous === code ? previous : code)
  }, [])

  const setHoveredRouteKeySafe = useCallback((key: string | null) => {
    setHoveredRouteKey(previous => previous === key ? previous : key)
  }, [])

  const onMarkerClick = useCallback((d: any) => {
    if (!d?.code || !globeRef.current) return
    const coords = COUNTRY_COORDS[d.code]
    if (coords) {
      globeRef.current.pointOfView({ lat: coords[0], lng: coords[1], altitude: fittedAltitude() }, reduced ? 0 : 700)
    }
  }, [reduced, fittedAltitude])

  // Marcadores HTML projetados no espaço 3D. Brasil, México e Chile recebem
  // uma camada de label geográfico mais precisa; os demais preservam exatamente
  // o marcador existente desta versão.
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
        isFeaturedLabel: FEATURED_COUNTRY_LABELS.has(country.code),
        isSelected: focusCode === country.code,
        altitude: FEATURED_COUNTRY_LABELS.has(country.code) ? 0.018 : 0.034,
      })
    }
    return list
  }, [countries, pulseCodes, focusCode])

  const createMarkerElement = useCallback((d: any) => {
    const wrapper = document.createElement('div')
    wrapper.className = `globe-marker-wrapper${d.isFeaturedLabel ? ' globe-country-label-wrapper' : ''}`
    wrapper.setAttribute('data-code', d.code)
    if (d.isFeaturedLabel) wrapper.setAttribute('data-featured-label', 'true')

    if (d.isFeaturedLabel) {
      const content = document.createElement('button')
      content.type = 'button'
      content.className = [
        'globe-country-label',
        `globe-country-label--${String(d.code).toLowerCase()}`,
        d.isPulse ? 'is-pulse' : '',
        d.isSelected ? 'is-selected' : '',
      ].filter(Boolean).join(' ')
      content.setAttribute('aria-label', `${d.name}, ${d.count} ${d.count === 1 ? 'visitante' : 'visitantes'} online agora`)
      content.setAttribute('title', `Localizar ${d.name} no globo`)

      const anchor = document.createElement('span')
      anchor.className = 'globe-country-label__anchor'
      anchor.setAttribute('aria-hidden', 'true')
      content.appendChild(anchor)

      const leader = document.createElement('span')
      leader.className = 'globe-country-label__leader'
      leader.setAttribute('aria-hidden', 'true')
      content.appendChild(leader)

      const badge = document.createElement('span')
      badge.className = 'globe-country-label__badge'

      const heading = document.createElement('span')
      heading.className = 'globe-country-label__heading'

      const flag = document.createElement('span')
      flag.className = 'globe-country-label__flag'
      flag.textContent = d.flag || '🌐'
      flag.setAttribute('aria-hidden', 'true')
      heading.appendChild(flag)

      const country = document.createElement('strong')
      country.className = 'globe-country-label__name'
      country.textContent = d.name
      heading.appendChild(country)
      badge.appendChild(heading)

      const metric = document.createElement('span')
      metric.className = 'globe-country-label__metric'
      const metricValue = document.createElement('strong')
      metricValue.textContent = String(d.count)
      const metricLabel = document.createElement('span')
      metricLabel.textContent = d.count === 1 ? ' visitante' : ' visitantes'
      metric.appendChild(metricValue)
      metric.appendChild(metricLabel)
      badge.appendChild(metric)

      const connector = document.createElement('span')
      connector.className = 'globe-country-label__connector'
      connector.setAttribute('aria-hidden', 'true')
      badge.appendChild(connector)

      content.appendChild(badge)
      content.addEventListener('mouseenter', () => setHoveredCountrySafe(d.code))
      content.addEventListener('mouseleave', () => setHoveredCountrySafe(null))
      content.addEventListener('click', (event) => {
        event.stopPropagation()
        onMarkerClick({ code: d.code })
      })

      wrapper.appendChild(content)
      return wrapper
    }

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
    content.addEventListener('mouseenter', () => setHoveredCountrySafe(d.code))
    content.addEventListener('mouseleave', () => setHoveredCountrySafe(null))

    // Clique centraliza a visualização
    content.addEventListener('click', (e) => {
      e.stopPropagation()
      onMarkerClick({ code: d.code })
    })

    wrapper.appendChild(content)
    return wrapper
  }, [onMarkerClick, setHoveredCountrySafe])

  const updateMarkerVisibility = useCallback((element: HTMLElement, isVisible: boolean) => {
    if (element.dataset.featuredLabel === 'true') {
      element.dataset.visible = isVisible ? 'true' : 'false'
      element.style.pointerEvents = isVisible ? 'auto' : 'none'
      return
    }
    element.style.visibility = isVisible ? 'visible' : 'hidden'
  }, [])

  // Camada geográfica: beacons reais por país + topologia contextual entre
  // geografias que estão realmente ativas no snapshot. O /api/live não fornece
  // pares origem→destino, então as linhas não afirmam uma jornada exata; elas
  // conectam apenas países presentes agora e usam foco, hover e novidade como
  // hierarquia visual, sempre preservando uma leitura limpa e precisa.
  const { points, rings, arcs } = useMemo(() => {
    const pts: any[] = []
    const rgs: any[] = []
    const routes: any[] = []

    const activeCountries = countries
      .filter(country => country.count > 0 && COUNTRY_COORDS[country.code])
      .sort((a, b) => b.count - a.count)

    const activeByCode = new Map(activeCountries.map(country => [country.code, country]))
    const activeFocusCode = hoveredCountry && activeByCode.has(hoveredCountry)
      ? hoveredCountry
      : focusCode && activeByCode.has(focusCode)
        ? focusCode
        : null

    const hoveredRouteParts = hoveredRouteKey?.split('->') ?? []
    const hoveredRouteCodes = new Set(hoveredRouteParts.length === 2 ? hoveredRouteParts : [])

    const routeLimit = size.width > 0 && size.width < 560 ? 4 : size.width < 900 ? 6 : 10
    const networkCountries: Country[] = []
    const networkCodes = new Set<string>()
    const pushCountry = (country?: Country) => {
      if (!country || networkCodes.has(country.code)) return
      networkCountries.push(country)
      networkCodes.add(country.code)
    }

    pushCountry(activeFocusCode ? activeByCode.get(activeFocusCode) : undefined)
    for (const code of pulseCodes) pushCountry(activeByCode.get(code))
    for (const country of activeCountries) {
      pushCountry(country)
      if (networkCountries.length >= routeLimit + 1) break
    }

    for (const country of activeCountries) {
      const coords = COUNTRY_COORDS[country.code]
      const name = countryName(country.code)
      const flag = countryFlag(country.code)
      const isPulse = pulseCodes.includes(country.code)
      const rel = Math.max(0.12, Math.min(1, country.count / maxCount))
      const isFocused = activeFocusCode === country.code
      const isHovered = hoveredCountry === country.code || hoveredRouteCodes.has(country.code)
      const haloAlpha = isFocused ? 0.54 : isPulse ? 0.42 : isHovered ? 0.34 : 0.18 + rel * 0.10
      const coreAlpha = isFocused ? 0.98 : isPulse ? 0.94 : isHovered ? 0.92 : 0.88
      const outerRadius = isFocused
        ? 0.30 + rel * 0.12
        : isPulse
          ? 0.27 + rel * 0.11
          : isHovered
            ? 0.25 + rel * 0.10
            : 0.21 + rel * 0.08
      const coreRadius = isFocused
        ? 0.135 + rel * 0.05
        : isPulse
          ? 0.122 + rel * 0.05
          : isHovered
            ? 0.112 + rel * 0.04
            : 0.096 + rel * 0.035
      const beaconColor = '#25f4ee'

      const tooltip = `<div class="presence-tooltip">
        <div class="presence-tooltip-header">
          <span class="presence-tooltip-flag">${flag}</span>
          <strong>${escapeHtml(name)}</strong>
          <span class="presence-tooltip-code">${country.code}</span>
        </div>
        <div class="presence-tooltip-stat">
          <span class="presence-tooltip-dot" style="background:${beaconColor};box-shadow:0 0 8px rgba(37, 244, 238, 0.28)"></span>
          <span class="presence-tooltip-count" style="color:${beaconColor}">${country.count}</span>
          <span class="presence-tooltip-label">${country.count === 1 ? 'visitante online agora' : 'visitantes online agora'}</span>
        </div>
        ${isPulse ? '<div class="presence-tooltip-lead-alert">⚡ NOVO LEAD DETECTADO</div>' : ''}
      </div>`

      pts.push({
        lat: coords[0],
        lng: coords[1],
        code: country.code,
        count: country.count,
        altitude: 0.006,
        radius: outerRadius,
        color: `rgba(37, 244, 238, ${haloAlpha.toFixed(3)})`,
        label: tooltip,
      })
      pts.push({
        lat: coords[0],
        lng: coords[1],
        code: country.code,
        count: country.count,
        altitude: 0.009,
        radius: coreRadius,
        color: `rgba(244, 255, 255, ${coreAlpha.toFixed(3)})`,
        label: tooltip,
      })

      if (isPulse && !reduced && !paused) {
        rgs.push({
          lat: coords[0],
          lng: coords[1],
          code: country.code,
          ringColor: (t: number) => `rgba(37, 244, 238, ${Math.max(0, (1 - t) * 0.26)})`,
          ringMaxRadius: isFocused ? 4.2 : 3.3,
          ringPropagationSpeed: 0.84,
          ringRepeatPeriod: 2300,
        })
      }
    }

    if (networkCountries.length > 1) {
      const hub = activeFocusCode
        ? networkCountries.find(country => country.code === activeFocusCode) ?? networkCountries[0]
        : networkCountries[0]
      const start = COUNTRY_COORDS[hub.code]
      const destinations = networkCountries.filter(country => country.code !== hub.code)

      destinations.forEach((country, index) => {
        const end = COUNTRY_COORDS[country.code]
        const distance = angularDistanceDegrees(start, end)
        const rel = Math.max(0.12, Math.min(1, country.count / maxCount))
        const routeKey = `${hub.code}->${country.code}`
        const isRecent = pulseCodes.includes(country.code) || pulseCodes.includes(hub.code)
        const isSelected = Boolean(activeFocusCode) && (hub.code === activeFocusCode || country.code === activeFocusCode)
        const isHoveredRoute = hoveredRouteKey === routeKey
        const isSecondary = !isRecent && !isSelected && (index < 3 || rel >= 0.42)
        const level = isHoveredRoute ? 'hover' : isRecent ? 'recent' : isSelected ? 'selected' : isSecondary ? 'secondary' : 'ambient'
        const peakAlpha = level === 'hover'
          ? 0.84
          : level === 'recent'
            ? 0.72
            : level === 'selected'
              ? 0.58
              : level === 'secondary'
                ? 0.42
                : 0.14 + rel * 0.06
        const edgeAlpha = level === 'hover'
          ? 0.14
          : level === 'recent'
            ? 0.12
            : level === 'selected'
              ? 0.09
              : level === 'secondary'
                ? 0.06
                : 0.018
        const altitude = Math.max(0.028, Math.min(0.086, 0.021 + (distance / 180) * 0.056 + (distance > 95 ? 0.005 : 0)))
        const animated = !reduced && !paused && (isRecent || isHoveredRoute)

        routes.push({
          key: routeKey,
          startLat: start[0],
          startLng: start[1],
          endLat: end[0],
          endLng: end[1],
          startCode: hub.code,
          endCode: country.code,
          altitude,
          stroke: level === 'hover' ? 0.11 : level === 'recent' ? 0.095 : level === 'selected' ? 0.082 : level === 'secondary' ? 0.064 : 0.046,
          color: [
            `rgba(37, 244, 238, ${edgeAlpha})`,
            `rgba(70, 206, 240, ${peakAlpha})`,
            `rgba(37, 244, 238, ${edgeAlpha})`,
          ],
          dashLength: animated ? (isHoveredRoute ? 0.065 : 0.045) : 1,
          dashGap: animated ? (isHoveredRoute ? 0.82 : 0.92) : 0,
          dashInitialGap: animated ? (index * 0.19) % 1 : 0,
          dashAnimateTime: animated ? Math.round(1500 + (distance / 180) * 1800) : 0,
        })
      })
    }

    return { points: pts, rings: rgs, arcs: routes }
  }, [countries, maxCount, pulseCodes, reduced, paused, focusCode, hoveredCountry, hoveredRouteKey, size.width])

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
    const renderer = globe.renderer()
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

    // Filtering/anisotropy melhora costas e relevo durante a rotação sem elevar
    // o pixel ratio do canvas inteiro. A configuração afeta somente os mapas da Terra.
    const anisotropy = Math.min(12, renderer.capabilities.getMaxAnisotropy())
    if (material.map) {
      material.map.colorSpace = THREE.SRGBColorSpace
      material.map.anisotropy = anisotropy
      material.map.minFilter = THREE.LinearMipmapLinearFilter
      material.map.magFilter = THREE.LinearFilter
      material.map.needsUpdate = true
    }
    if (material.bumpMap) {
      material.bumpMap.colorSpace = THREE.NoColorSpace
      material.bumpMap.anisotropy = anisotropy
      material.bumpMap.minFilter = THREE.LinearMipmapLinearFilter
      material.bumpMap.magFilter = THREE.LinearFilter
      material.bumpMap.needsUpdate = true
    }
    if (material.emissiveMap) {
      material.emissiveMap.anisotropy = anisotropy
      material.emissiveMap.needsUpdate = true
    }

    // Preenchimento mais aberto evita continentes apagados durante a rotação.
    const fill = new THREE.AmbientLight('#e5efff', 1.25)
    const key = new THREE.DirectionalLight('#f7fbff', 2.65)
    key.position.set(-162, 102, 214)
    const coolFill = new THREE.DirectionalLight('#9fc9e2', 0.65)
    coolFill.position.set(94, 38, 132)
    const cyanRim = new THREE.DirectionalLight('#4fe0ff', 0.42)
    cyanRim.position.set(170, -42, -154)
    const violetRim = new THREE.DirectionalLight('#8570ff', 0.11)
    violetRim.position.set(-146, -26, -142)
    globe.lights([fill, key, coolFill, cyanRim, violetRim])
    if (!cameraInitialized.current) {
      const coords = initialFocus.current ? COUNTRY_COORDS[initialFocus.current] : undefined
      globe.pointOfView({ lat: coords?.[0] ?? 8, lng: coords?.[1] ?? -48, altitude: fittedAltitude() }, 0)
      cameraInitialized.current = true
    }
    setReady(true)
  }, [fittedAltitude, material])

  useEffect(() => {
    if (!ready) return
    const globe = globeRef.current
    if (!globe) return
    let visible = true
    const renderVisibility = () => {
      containerRef.current?.setAttribute('data-render-active', String(!document.hidden && visible))
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
      data-motion-paused={paused || reduced}
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
      <div ref={canvasRef} className="presence-canvas">
        <div className="presence-orbital-field" aria-hidden="true" />
        {size.width > 0 && <GlobeGL key={attempt} ref={globeRef} width={size.width} height={Math.max(1, size.height)}
          onGlobeReady={onReady} globeMaterial={material} backgroundColor="rgba(0,0,0,0)"
          globeImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-blue-marble.jpg'}
          bumpImageUrl={textureFailed ? undefined : '/dashboard/textures/earth-topology.png'}
          showGraticules={textureFailed}
          showAtmosphere atmosphereColor="#91dcfa" atmosphereAltitude={0.022}
          htmlElementsData={htmlMarkers}
          htmlLat="lat"
          htmlLng="lng"
          htmlAltitude="altitude"
          htmlElement={createMarkerElement}
          htmlElementVisibilityModifier={updateMarkerVisibility}
          htmlTransitionDuration={reduced ? 0 : 220}
          arcsData={arcs}
          arcStartLat="startLat"
          arcStartLng="startLng"
          arcEndLat="endLat"
          arcEndLng="endLng"
          arcAltitude={(d: any) => d.altitude}
          arcColor={(d: any) => d.color}
          arcStroke={(d: any) => d.stroke}
          arcDashLength={(d: any) => d.dashLength}
          arcDashGap={(d: any) => d.dashGap}
          arcDashInitialGap={(d: any) => d.dashInitialGap}
          arcDashAnimateTime={(d: any) => d.dashAnimateTime}
          arcsTransitionDuration={reduced ? 0 : 420}
          pointsData={points} pointLat="lat" pointLng="lng"
          pointAltitude={(d: any) => d.altitude}
          pointRadius={(d: any) => d.radius}
          pointResolution={28}
          pointColor={(d: any) => d.color}
          pointLabel="label"
          pointsTransitionDuration={0}
          onPointHover={(d: any) => setHoveredCountrySafe(d?.code ?? null)}
          onPointClick={onMarkerClick}
          onArcHover={(d: any) => setHoveredRouteKeySafe(d?.key ?? null)}
          ringsData={rings} ringLat="lat" ringLng="lng" ringAltitude={0.010}
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
