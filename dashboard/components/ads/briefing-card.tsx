'use client'

/**
 * Briefing diário com IA — card compacto que mostra o briefing de hoje (ou o
 * mais recente), badges de anomalias detectadas por z-score e um botão para
 * gerar sob demanda. Histórico de 7 dias em expansor.
 *
 * Sem IA configurada (resposta ai:false), o card não renderiza nada — a aba
 * fica idêntica ao comportamento pré-IA.
 */

import { useState } from 'react'
import { useAdsBriefing, apiSend } from '@/lib/api'
import type { AdsAnomaly, AdsBriefing } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Bot, Sparkles } from 'lucide-react'

const METRIC_LABEL: Record<AdsAnomaly['metric'], string> = {
  spend: 'Gasto',
  cpa: 'CPA',
  ctr: 'CTR',
  cpm: 'CPM',
}

function AnomalyBadge({ a }: { a: AdsAnomaly }) {
  const bad = a.severity === 'bad'
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ' +
        (bad
          ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400')
      }
      title={`z-score ${a.z > 0 ? '+' : ''}${a.z.toFixed(1)} vs. média dos últimos dias`}
    >
      {METRIC_LABEL[a.metric]} {a.direction === 'up' ? '↑' : '↓'}
    </span>
  )
}

function BriefingBody({ b }: { b: AdsBriefing }) {
  const anomalies = b.meta.anomalies ?? []
  return (
    <div className="flex flex-col gap-2">
      {anomalies.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {anomalies.map((a, i) => (
            <AnomalyBadge key={`${a.metric}-${a.day}-${i}`} a={a} />
          ))}
        </div>
      )}
      <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">{b.content}</p>
      {!b.meta.usedAi && (
        <p className="text-[10px] text-muted-foreground">
          Resumo automático (IA indisponível no momento da geração)
        </p>
      )}
    </div>
  )
}

export function BriefingCard({ adAccountId, currency }: { adAccountId: string; currency: string }) {
  const { data, mutate } = useAdsBriefing(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)

  // IA desligada no servidor ou primeira carga: não ocupa espaço na aba
  if (!data || !data.ai) return null

  const briefings = data.briefings
  const today = new Date().toISOString().slice(0, 10)
  const latest = briefings[0]
  const isToday = latest?.date === today
  const history = briefings.filter((b) => b !== latest)

  async function generateNow() {
    setGenerating(true)
    setError(null)
    try {
      await apiSend('/api/ads/briefing/run', 'POST', { adAccountId, currency })
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao gerar briefing')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <GlassCard className="p-4 relative overflow-hidden bg-gradient-to-br from-brand-cyan/10 via-transparent to-purple-500/5 border border-white/5 shadow-[0_0_20px_rgba(37,244,238,0.1)]">
      <div className="absolute inset-0 bg-gradient-to-br from-brand-cyan/5 to-transparent opacity-50 mix-blend-overlay" aria-hidden="true" />
      <div className="relative flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Bot className="size-4 text-brand-cyan animate-pulse" aria-hidden="true" />
          <p className="label-mono bg-gradient-to-r from-brand-cyan to-white bg-clip-text text-transparent">Briefing diário</p>
          {latest && (
            <span className="text-[10px] text-brand-cyan/70 font-medium">
              {isToday ? 'hoje' : latest.date}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={generateNow}
          disabled={generating}
          className="flex items-center gap-1.5 rounded-lg border border-brand-cyan/30 bg-brand-cyan/10 px-2.5 py-1 text-[11px] font-medium text-brand-cyan transition-all hover:bg-brand-cyan/20 hover:shadow-[0_0_10px_rgba(37,244,238,0.2)] disabled:opacity-50"
        >
          {generating ? 'Gerando…' : (
            <>
              <Sparkles className="size-3" aria-hidden="true" />
              {isToday ? 'Regenerar' : 'Gerar agora'}
            </>
          )}
        </button>
      </div>

      {error && <p className="mt-2 text-[11px] text-red-400">{error}</p>}

      <div className="mt-3">
        {latest ? (
          <BriefingBody b={latest} />
        ) : (
          <p className="text-xs text-muted-foreground">
            Nenhum briefing ainda. O servidor gera um por dia automaticamente, ou clique em
            &quot;Gerar agora&quot;.
          </p>
        )}
      </div>

      {history.length > 0 && (
        <div className="mt-3 border-t border-border pt-2">
          <button
            type="button"
            onClick={() => setShowHistory((v) => !v)}
            className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showHistory}
          >
            {showHistory ? 'Ocultar histórico' : `Histórico (${history.length})`}
          </button>
          {showHistory && (
            <div className="mt-2 flex flex-col gap-3">
              {history.map((b) => (
                <div key={b.date} className="rounded-lg border border-border/60 p-2.5">
                  <p className="mb-1.5 text-[10px] font-medium text-muted-foreground">{b.date}</p>
                  <BriefingBody b={b} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
