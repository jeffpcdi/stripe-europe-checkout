'use client'

import { useEffect, useRef, useState } from 'react'
import GlobeGL from 'react-globe.gl'
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

export default function GlobePanel({ countries }: GlobePanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const globeRef = useRef<any>(null)
  const [size, setSize] = useState({ w: 0, h: 420 })

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

  useEffect(() => {
    const g = globeRef.current
    if (!g) return
    g.controls().autoRotate = true
    g.controls().autoRotateSpeed = 0.6
    g.controls().enableZoom = false
    g.pointOfView({ lat: 20, lng: -30, altitude: 2.2 }, 0)
  }, [size.w])

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

  return (
    <div ref={containerRef} className="relative h-[420px] w-full overflow-hidden">
      {size.w > 0 && (
        <GlobeGL
          ref={globeRef}
          width={size.w}
          height={size.h}
          backgroundColor="rgba(0,0,0,0)"
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
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
        />
      )}
    </div>
  )
}
