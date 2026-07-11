'use client'

import { useState } from 'react'
import { Activity, RefreshCw, Timer, Layers, ShieldCheck, CircleAlert } from 'lucide-react'
import { useOps, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { toast } from '@/lib/toast'
import { timeAgo } from '@/lib/format'

// Formata uma duração em ms para leitura humana curta (s / min / h).
function dur(ms: number): string {
  if (!ms || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min`
  const h = Math.round(m / 60)
  return `${h} h`
}

// Painel de saúde das filas duráveis (Leva 5, bloco I: 191–200).
// Traduz contadores internos do backend em linguagem operacional: quantas
// conversões aguardam disparo, se o worker está vivo, quão rápido o webhook
// vira evento no TikTok, e quantas reentregas foram ignoradas.
export function QueueHealthPanel() {
  const { data, mutate, isLoading } = useOps()
  const [draining, setDraining] = useState(false)

  async function handleDrain() {
    setDraining(true)
    try {
      const r = await apiSend<{ ok: boolean; processed: number; remaining: number }>(
        '/api/ops/drain-retry',
        'POST',
      )
      toast.success(
        r.processed > 0
          ? `${r.processed} evento(s) reprocessado(s)`
          : 'Nenhum evento pendente para reprocessar',
        { hint: r.remaining > 0 ? `${r.remaining} ainda na fila (aguardando resposta do TikTok).` : undefined },
      )
      mutate()
    } catch (e) {
      toast.error('Falha ao forçar a fila de retry', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setDraining(false)
    }
  }

  const queueTotal = data ? data.convQueue.queue + data.convQueue.processing : 0
  const workerActive = data?.worker.active ?? false
  const retry = data?.capiRetry ?? { count: 0, oldestAgeMs: 0 }
  const lat = data?.convLatency ?? { count: 0, p50: 0, p95: 0, max: 0 }

  return (
    <GlassCard className="min-w-0 p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Saúde da fila de conversões</h2>
          <p className="text-xs text-muted-foreground">
            Nenhuma venda confirmada se perde — acompanhe o caminho do webhook até o TikTok
          </p>
        </div>
        <button
          type="button"
          onClick={handleDrain}
          disabled={draining || retry.count === 0}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          title={retry.count === 0 ? 'Nada na fila de retry para reprocessar' : 'Tenta reenviar agora, ignorando o intervalo de espera'}
        >
          <RefreshCw className={`size-3.5 ${draining ? 'animate-spin' : ''}`} />
          {draining ? 'Reprocessando…' : 'Forçar reenvio'}
        </button>
      </div>

      {/* Aviso quando o Redis não está ligado: a fila cai para o modo em memória
          (best-effort), que não sobrevive a um restart. */}
      {data && !data.redisEnabled && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-[color:var(--warning)]/25 bg-[color:var(--warning)]/8 px-3 py-2 text-xs text-muted-foreground text-pretty">
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
          <span>
            Redis desligado — a fila roda em memória e <strong className="text-foreground">não sobrevive a reinícios</strong>.
            Conecte o Redis para durabilidade total das conversões.
          </span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {/* Conversões na fila */}
        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers className="size-3.5" /> Na fila
          </div>
          <p className="text-xl font-semibold text-foreground">{isLoading ? '—' : queueTotal}</p>
          <p className="text-[11px] text-muted-foreground">
            {data ? `${data.convQueue.processing} em processamento` : 'aguardando disparo'}
          </p>
        </div>

        {/* Worker de drenagem */}
        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="size-3.5" /> Worker
          </div>
          <StatusBadge status={workerActive ? 'success' : 'neutral'} dot>
            {workerActive ? 'ativo' : 'ocioso'}
          </StatusBadge>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {data?.worker.at ? `tick ${timeAgo(new Date(data.worker.at).toISOString())}` : 'sem atividade recente'}
          </p>
        </div>

        {/* Latência webhook→disparo */}
        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Timer className="size-3.5" /> Latência
          </div>
          <p className="text-xl font-semibold text-foreground">
            {lat.count ? `${lat.p50}ms` : '—'}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {lat.count ? `p95 ${lat.p95}ms · máx ${lat.max}ms` : 'webhook → TikTok'}
          </p>
        </div>

        {/* Fila de retry da CAPI */}
        <div className="rounded-xl border border-border bg-secondary/40 p-3">
          <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <RefreshCw className="size-3.5" /> Retry CAPI
          </div>
          <p className="text-xl font-semibold text-foreground">{isLoading ? '—' : retry.count}</p>
          <p className="text-[11px] text-muted-foreground">
            {retry.count ? `mais antigo há ${dur(retry.oldestAgeMs)}` : 'sem reenvios pendentes'}
          </p>
        </div>
      </div>

      {/* Rodapé: idempotência + último reprocessamento de órfãos */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="size-3.5 text-success" />
          {data ? `${data.webhookDedup} reentrega(s) ignorada(s)` : 'idempotência ativa'}
        </span>
        {data && data.reclaim.at > 0 && (
          <span>
            Último resgate de órfãos: {data.reclaim.moved} item(ns) {timeAgo(new Date(data.reclaim.at).toISOString())}
          </span>
        )}
      </div>
    </GlassCard>
  )
}
