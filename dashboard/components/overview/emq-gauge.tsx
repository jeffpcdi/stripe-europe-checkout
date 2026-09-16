'use client'

import Link from 'next/link'

interface EmqGaugeProps {
  score: number | null
  dir?: 'up' | 'down' | 'flat'
  alerts?: number
}

export function EmqGauge({ score, dir = 'flat', alerts = 0 }: EmqGaugeProps) {
  const max = 10
  const available = score !== null && Number.isFinite(score)
  const normalized = available ? Math.min(Math.max(score, 0), max) : 0
  const isGood = normalized >= 7
  const isMed = normalized >= 4 && normalized < 7
  const statusLabel = !available ? 'Sem dados recentes' : isGood ? 'Boa cobertura' : isMed ? 'Cobertura parcial' : 'Poucos dados'
  const trendLabel = !available ? 'Aguardando eventos' : dir === 'up' ? 'Subindo' : dir === 'down' ? 'Caindo' : 'Estável'
  const tooltipText = 'Estimativa de completude dos dados enviados. Não é a nota oficial do TikTok nem uma garantia de correspondência.'

  return (
    <Link
      href="/conversions?tab=pixels"
      data-tooltip={tooltipText}
      className="overview-data-score"
      aria-label={`${available ? `${normalized.toFixed(1).replace('.', ',')} de ${max}` : 'Sem dados recentes'}. ${statusLabel}. ${trendLabel}. Abrir detalhes dos pixels.`}
    >
      <div className="overview-data-score-main">
        <strong className="overview-data-score-value">
          {available ? normalized.toFixed(1).replace('.', ',') : '—'}
        </strong>
        <span className="overview-data-score-max">/ {max}</span>
      </div>

      <div className="overview-data-score-meta">
        <span className={`overview-data-status overview-data-status--${!available ? 'empty' : isGood ? 'good' : isMed ? 'medium' : 'low'}`}>
          {statusLabel}
        </span>
        <span className="overview-data-meta-separator" aria-hidden="true">·</span>
        <span className="overview-data-trend">{trendLabel}</span>
        {alerts > 0 ? (
          <>
            <span className="overview-data-meta-separator" aria-hidden="true">·</span>
            <span className="overview-data-alerts">{alerts} {alerts === 1 ? 'alerta' : 'alertas'}</span>
          </>
        ) : null}
      </div>
    </Link>
  )
}
