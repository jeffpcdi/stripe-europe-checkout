'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Activity, RefreshCw, Timer, Layers, ShieldCheck, CircleAlert, Trash2, Inbox, ChevronDown, Check } from 'lucide-react'
import { useOps, useQuarantine, apiSend, fetcher } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
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

// Item 200: retenção dos logs — mostra os limites efetivos de cada log e
// permite limpar manualmente por aba (só os dados DESTA conta).
interface RetentionResponse {
  ok: boolean
  retention: Record<string, { label: string; limite: string }>
}

export function RetentionPanel() {
  const { data } = useSWR<RetentionResponse>('/api/ops/retention', fetcher, {
    revalidateOnFocus: false,
  })
  const [clearing, setClearing] = useState<string | null>(null)
  const [confirmScope, setConfirmScope] = useState<string | null>(null)

  async function handleClear(scope: string) {
    setClearing(scope)
    try {
      const r = await apiSend<{ ok: boolean; removed: number }>('/api/ops/clear-log', 'POST', { scope })
      toast.success(
        r.removed > 0 ? `${r.removed} entrada(s) removida(s)` : 'Nada para limpar neste log',
      )
    } catch (e) {
      toast.error('Falha ao limpar o log', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setClearing(null)
    }
  }

  if (!data?.retention) return null
  const entries = Object.entries(data.retention)
  const confirmed = confirmScope ? data.retention[confirmScope] : null

  return (
    <GlassCard className="min-w-0 p-5">
      <h2 className="section-head mb-1 text-sm font-semibold text-foreground">Retenção dos logs</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Cada log tem um limite automático — aqui você vê os limites e pode limpar manualmente os dados
        da sua conta
      </p>
      <ul className="flex flex-col gap-1.5">
        {entries.map(([scope, info]) => (
          <li
            key={scope}
            className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2 text-xs"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-medium text-foreground">{info.label}</span>
              <span className="text-[11px] text-muted-foreground">{info.limite}</span>
            </span>
            <button
              type="button"
              onClick={() => setConfirmScope(scope)}
              disabled={clearing !== null}
              className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className={`size-3 ${clearing === scope ? 'animate-pulse' : ''}`} aria-hidden="true" />
              {clearing === scope ? 'Limpando…' : 'Limpar'}
            </button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={confirmScope !== null}
        title={confirmed ? `Limpar ${confirmed.label.toLowerCase()}?` : 'Limpar log?'}
        description="A limpeza remove apenas os dados da sua conta e é irreversível. Os logs voltam a acumular normalmente a partir de agora."
        confirmLabel="Limpar agora"
        onClose={() => setConfirmScope(null)}
        onConfirm={() => {
          if (confirmScope) handleClear(confirmScope)
          setConfirmScope(null)
        }}
      />
    </GlassCard>
  )
}

// Itens 230/232: integridade referencial + dados órfãos. Mostra links com
// referências quebradas (pixel/domínio apagado) e stats de cloak de slugs que
// não existem mais, com ação de corrigir os órfãos seguros. Painel OCULTO no
// caminho saudável — só aparece quando há algo a corrigir.
interface IntegrityResponse {
  ok: boolean
  problemas: { tipo: string; slug: string; ref: string; msg: string }[]
  orfaosCloak: string[]
  corrigidos?: number
}

export function IntegrityPanel() {
  const { data, mutate } = useSWR<IntegrityResponse>('/api/ops/integrity', fetcher, {
    revalidateOnFocus: false,
  })
  const [fixing, setFixing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const total = (data?.problemas?.length ?? 0) + (data?.orfaosCloak?.length ?? 0)
  if (!data || total === 0) return null

  async function handleFix() {
    setFixing(true)
    try {
      const r = await fetcher<IntegrityResponse>('/api/ops/integrity?fix=1')
      toast.success(
        r.corrigidos && r.corrigidos > 0
          ? `${r.corrigidos} problema(s) corrigido(s)`
          : 'Nada para corrigir automaticamente',
      )
      mutate()
    } catch (e) {
      toast.error('Falha ao corrigir os problemas', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setFixing(false)
    }
  }

  return (
    <GlassCard className="min-w-0 p-5">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <CircleAlert className="size-4 text-[color:var(--warning)]" aria-hidden="true" />
          <h2 className="section-head text-sm font-semibold text-foreground">Integridade da configuração</h2>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={fixing}
          className="rounded-md border border-border px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {fixing ? 'Corrigindo…' : 'Corrigir automaticamente'}
        </button>
      </div>
      <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
        {data.problemas.map((p, i) => (
          <li key={`${p.tipo}-${p.slug}-${i}`} className="flex items-start gap-1.5">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[color:var(--warning)]" aria-hidden="true" />
            <span className="text-pretty">{p.msg}</span>
          </li>
        ))}
        {data.orfaosCloak.length > 0 && (
          <li className="flex items-start gap-1.5">
            <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[color:var(--warning)]" aria-hidden="true" />
            <span className="text-pretty">
              {data.orfaosCloak.length} estatística(s) de cloaker de link(s) já apagado(s) ocupando espaço.
            </span>
          </li>
        )}
      </ul>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground text-pretty">
        A correção automática limpa apenas referências quebradas e estatísticas órfãs — nunca dados de venda.
      </p>
      <ConfirmDialog
        open={confirmOpen}
        title="Corrigir problemas de integridade?"
        description="Referências de pixel apagado serão removidas dos links e as estatísticas de cloaker órfãs serão limpas. Dados de venda não são tocados."
        confirmLabel="Corrigir agora"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          handleFix()
        }}
      />
    </GlassCard>
  )
}

// ── Quarentena de webhooks REJEITADOS (prioridade #1 do handoff) ───────────
// Antes, um webhook recusado tinha o corpo DESCARTADO — o valor de uma venda
// que não casava com nenhum alias sumia sem deixar rastro. Agora o payload cru
// fica preservado aqui: o operador expande a linha, vê o JSON EXATO que o
// gateway mandou, descobre onde está o valor/e-mail e reporta o alias que
// falta. Painel OCULTO quando não há nada em quarentena (caminho saudável).
export function QuarantinePanel() {
  const { data, mutate } = useQuarantine()
  const [expanded, setExpanded] = useState<number | null>(null)
  const [resolving, setResolving] = useState<number | null>(null)

  const items = data?.items ?? []
  // Sem itens pendentes: não polui o diagnóstico. (data undefined = ainda carregando)
  if (!data || items.length === 0) return null

  async function handleResolve(id: number) {
    setResolving(id)
    try {
      await apiSend('/api/conversion/quarantine/resolve', 'POST', { id })
      toast.success('Item marcado como resolvido')
      mutate()
    } catch (e) {
      toast.error('Falha ao resolver o item', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setResolving(null)
    }
  }

  return (
    <GlassCard className="min-w-0 p-5">
      <div className="mb-1 flex items-center gap-2">
        <Inbox className="size-4 text-[color:var(--warning)]" aria-hidden="true" />
        <h2 className="section-head text-sm font-semibold text-foreground">Webhooks em quarentena</h2>
        <span className="rounded-full bg-[color:var(--warning)]/15 px-2 py-0.5 text-[11px] font-semibold text-[color:var(--warning)]">
          {data.pending}
        </span>
      </div>
      <p className="mb-3 text-xs text-muted-foreground text-pretty">
        Webhooks recusados (segredo/assinatura inválida, valor não reconhecido ou formato desconhecido). O
        corpo original fica guardado aqui para você ver o que o gateway enviou e descobrir o que faltou.
      </p>
      <ul className="flex max-h-[32rem] flex-col gap-1 overflow-y-auto">
        {items.map((item) => {
          const isOpen = expanded === item.id
          return (
            <li key={item.id} className="rounded-lg border border-border text-xs">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : item.id)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left hover:bg-secondary/60"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-[color:var(--warning)]" aria-hidden="true" />
                  <span className="truncate font-mono text-foreground">{item.gateway_hint || 'desconhecido'}</span>
                  <span className="truncate text-muted-foreground">{item.rejection_reason || 'rejeitado'}</span>
                </span>
                <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  {timeAgo(item.received_at)}
                  <ChevronDown className={`size-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                </span>
              </button>
              {isOpen && (
                <div className="mx-2 mb-2 flex flex-col gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-[11px]">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                    <dt className="text-muted-foreground">Rota</dt>
                    <dd className="font-mono text-foreground">{item.route || '—'}</dd>
                    <dt className="text-muted-foreground">Motivo</dt>
                    <dd className="text-foreground text-pretty">{item.rejection_reason || '—'}</dd>
                  </div>
                  <div>
                    <p className="mb-1 text-muted-foreground">Payload recebido (cru)</p>
                    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background/60 p-2 font-mono text-[10px] leading-relaxed text-foreground">
                      {JSON.stringify(item.raw_payload, null, 2)}
                    </pre>
                  </div>
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => handleResolve(item.id)}
                      disabled={resolving !== null}
                      className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
                    >
                      <Check className={`size-3 ${resolving === item.id ? 'animate-pulse' : ''}`} aria-hidden="true" />
                      {resolving === item.id ? 'Resolvendo…' : 'Marcar como resolvido'}
                    </button>
                  </div>
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </GlassCard>
  )
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
            Acompanhe o processamento, as tentativas de envio e as falhas.
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
        {/* Item 225: dedup de disparos — o "faltou disparo" evitado de propósito */}
        {data?.pixelDedup && data.pixelDedup.deduped > 0 && (
          <span>{data.pixelDedup.deduped} disparo(s) deduplicado(s) (navegador × servidor)</span>
        )}
        {data && data.reclaim.at > 0 && (
          <span>
            Último resgate de órfãos: {data.reclaim.moved} item(ns) {timeAgo(new Date(data.reclaim.at).toISOString())}
          </span>
        )}
      </div>

      {/* Itens 220/223/224/226: métricas técnicas de presença e caches */}
      {data && (data.presence || data.asnCache) && (
        <div className="mt-3 border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            {data.presence && (
              <span>
                <span className="font-medium text-foreground">{data.presence.online}</span> online agora
                {/* Item 220: aviso ao encostar no teto do SCAN de presença */}
                {data.presence.near && (
                  <span className="ml-1 text-warning">
                    (perto do teto de {data.presence.limit} — contagem pode ficar truncada)
                  </span>
                )}
              </span>
            )}
            {data.asnCache && data.asnCache.total > 0 && (
              <span title={`${data.asnCache.memHits} hits memória · ${data.asnCache.redisHits} hits Redis · ${data.asnCache.liveLookups} lookups DNS`}>
                cache de infraestrutura (ASN):{' '}
                <span className="font-medium text-foreground">
                  {Math.round(data.asnCache.hitRate * 100)}% de acerto
                </span>{' '}
                · {data.asnCache.entries} IPs em memória
              </span>
            )}
            {/* Item 224: TTLs efetivos das camadas de cache */}
            {data.cacheTtls && (
              <span title="Tempo que cada camada lembra do visitante antes de re-julgar">
                TTLs: presença {fmtTtl(data.cacheTtls.presence)} · dedup {fmtTtl(data.cacheTtls.dedup)} · bot (sticky){' '}
                {fmtTtl(data.cacheTtls.sticky)} · ttclid {fmtTtl(data.cacheTtls.ttclid)} · ASN {fmtTtl(data.cacheTtls.asn)}
              </span>
            )}
          </div>
          {/* Item 226: presença por entrada do funil (qual /go ou /c está com gente) */}
          {data.presence && data.presence.byEntry.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {data.presence.byEntry.map((e) => (
                <span
                  key={e.entry}
                  className="inline-flex items-center gap-1 rounded bg-secondary px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                >
                  {e.entry} <span className="font-semibold text-foreground">{e.count}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}

// Item 224: formata TTL em segundos para leitura humana (pt-BR)
function fmtTtl(sec: number | undefined): string {
  if (!sec) return '—'
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.round(sec / 60)}min`
  if (sec % 3600 === 0) return `${sec / 3600}h`
  return `${(sec / 3600).toFixed(1)}h`
}
