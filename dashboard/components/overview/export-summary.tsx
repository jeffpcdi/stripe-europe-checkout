'use client'

// Item 278: exporta o resumo do período como imagem PNG (canvas puro, sem
// dependência). Gera um card 1200×630 (proporção de compartilhamento) na
// identidade do painel: fundo escuro, acento ciano, KPIs grandes.

import { useState } from 'react'
import { ImageDown } from 'lucide-react'
import { money } from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'
import type { Period } from '@/lib/types'

const PERIOD_LABEL: Record<Period, string> = {
  today: 'Hoje',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  all: 'Todo o histórico',
}

interface SummaryData {
  revenue: number
  mainCur: string
  sales: number
  visits: number
  overall: number
  approval: number
  series: number[]
}

export function ExportSummaryButton({
  period,
  summary,
}: {
  period: Period
  summary: SummaryData
}) {
  const [busy, setBusy] = useState(false)

  function draw() {
    setBusy(true)
    try {
      const W = 1200
      const H = 630
      const canvas = document.createElement('canvas')
      canvas.width = W
      canvas.height = H
      const ctx = canvas.getContext('2d')
      if (!ctx) return

      // fundo
      ctx.fillStyle = '#05060a'
      ctx.fillRect(0, 0, W, H)
      // halo ciano sutil no canto
      const glow = ctx.createRadialGradient(W - 150, 100, 0, W - 150, 100, 500)
      glow.addColorStop(0, 'rgba(37,244,238,0.10)')
      glow.addColorStop(1, 'rgba(37,244,238,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, W, H)
      // borda
      ctx.strokeStyle = 'rgba(255,255,255,0.10)'
      ctx.lineWidth = 2
      ctx.strokeRect(1, 1, W - 2, H - 2)

      const mono = "'Geist Mono', 'JetBrains Mono', monospace"
      const sans = "'Geist', system-ui, sans-serif"

      // cabeçalho
      ctx.fillStyle = '#25f4ee'
      ctx.font = `600 22px ${mono}`
      ctx.fillText('ROI-NADOS', 64, 78)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `400 22px ${sans}`
      ctx.fillText(`Resumo · ${PERIOD_LABEL[period]}`, 210, 78)
      ctx.textAlign = 'right'
      ctx.fillText(new Date().toLocaleDateString('pt-BR'), W - 64, 78)
      ctx.textAlign = 'left'

      // receita (destaque)
      ctx.fillStyle = 'rgba(255,255,255,0.55)'
      ctx.font = `500 24px ${sans}`
      ctx.fillText('RECEITA TOTAL', 64, 170)
      ctx.fillStyle = '#22c55e'
      ctx.font = `700 88px ${mono}`
      ctx.fillText(money(summary.revenue, summary.mainCur), 64, 265)

      // sparkline da série
      const s = summary.series
      if (s.length > 1) {
        const max = Math.max(...s, 1)
        const x0 = 64
        const y0 = 330
        const w = W - 128
        const h = 90
        ctx.beginPath()
        s.forEach((v, i) => {
          const x = x0 + (i / (s.length - 1)) * w
          const y = y0 + h - (v / max) * h
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        })
        ctx.strokeStyle = '#25f4ee'
        ctx.lineWidth = 3
        ctx.stroke()
        ctx.lineTo(x0 + w, y0 + h)
        ctx.lineTo(x0, y0 + h)
        ctx.closePath()
        ctx.fillStyle = 'rgba(37,244,238,0.08)'
        ctx.fill()
      }

      // KPIs secundários em 4 colunas
      const kpis: [string, string][] = [
        ['VENDAS', String(summary.sales)],
        ['LEADS', String(summary.visits)],
        ['CONVERSÃO', fmtPercent(summary.overall)],
        ['APROVAÇÃO', fmtPercent(summary.approval)],
      ]
      const colW = (W - 128) / 4
      kpis.forEach(([label, value], i) => {
        const x = 64 + i * colW
        ctx.fillStyle = 'rgba(255,255,255,0.45)'
        ctx.font = `500 20px ${sans}`
        ctx.fillText(label, x, 510)
        ctx.fillStyle = '#ffffff'
        ctx.font = `700 44px ${mono}`
        ctx.fillText(value, x, 562)
      })

      // download
      const a = document.createElement('a')
      a.download = `roi-nados-resumo-${period}-${new Date().toISOString().slice(0, 10)}.png`
      a.href = canvas.toDataURL('image/png')
      a.click()
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={draw}
      disabled={busy}
      title="Exportar resumo como imagem"
      aria-label="Exportar resumo do período como imagem PNG"
      className="flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-ring hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
    >
      <ImageDown className="size-4" aria-hidden="true" />
    </button>
  )
}
