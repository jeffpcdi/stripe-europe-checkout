'use client'

import { useEffect, useRef } from 'react'
import { useStats, useHealth } from '@/lib/api'

const BASE_TITLE = 'ROI-NADOS — Tracking & Conversões'

/**
 * Itens 201/202: título da aba dinâmico e favicon com dot de status.
 * - "(N) ROI-NADOS" quando chegam vendas com a aba em segundo plano
 * - favicon ganha ponto verde quando o sistema está saudável
 */
export function TabNotifier() {
  const { data: stats } = useStats()
  const { data: health } = useHealth()
  const totalSales = stats?.totals?.sales
  const seenSales = useRef<number | null>(null)
  const unseen = useRef(0)

  // Título: conta vendas chegadas com a aba oculta
  useEffect(() => {
    if (typeof totalSales !== 'number') return
    if (seenSales.current === null) {
      seenSales.current = totalSales
      return
    }
    const delta = totalSales - seenSales.current
    if (delta > 0 && document.hidden) {
      unseen.current += delta
      document.title = `(${unseen.current}) ROI-NADOS`
    }
    seenSales.current = totalSales

    function onVisible() {
      if (!document.hidden) {
        unseen.current = 0
        document.title = BASE_TITLE
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [totalSales])

  // Favicon: dot verde quando saudável, rosa quando não
  useEffect(() => {
    if (!health) return
    const ok = health.db
    const canvas = document.createElement('canvas')
    canvas.width = 32
    canvas.height = 32
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      ctx.beginPath()
      ctx.arc(16, 16, 16, 0, Math.PI * 2)
      ctx.closePath()
      ctx.clip()
      ctx.drawImage(img, 0, 0, 32, 32)
      // dot de status no canto inferior direito
      ctx.beginPath()
      ctx.arc(25, 25, 6, 0, Math.PI * 2)
      ctx.fillStyle = '#08080a'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(25, 25, 4.5, 0, Math.PI * 2)
      ctx.fillStyle = ok ? '#22c55e' : '#fe2c55'
      ctx.fill()
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
      if (!link) {
        link = document.createElement('link')
        link.rel = 'icon'
        document.head.appendChild(link)
      }
      link.href = canvas.toDataURL('image/png')
    }
    img.src = '/dashboard/roi-nados-logo.jpg'
  }, [health])

  return null
}
