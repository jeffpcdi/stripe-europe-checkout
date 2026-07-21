'use client'

// Painel de Operações do TikTok Ads — duas seções:
// 1. Jobs duráveis (bulk/duplicação) persistidos no Neon: histórico com
//    progresso, tentativas e erro por job (sobrevive a reinícios do servidor).
// 2. Política de segurança (guardrails): dry-run, kill switch, teto de gasto
//    diário e % máxima de mudança de orçamento — vale para TODA ação de
//    escrita (manual, automação e IA).

import { useEffect, useRef, useState } from 'react'
import {
  ShieldCheck,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  ListChecks,
  OctagonAlert,
  X,
} from 'lucide-react'
import { useAdsOpsJobs, useAdsSafetyPolicy, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsOpsJob, AdsSafetyPolicy } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const STATUS_META: Record<AdsOpsJob['status'], { label: string; tone: string }> = {
  queued: { label: 'na fila', tone: 'text-muted-foreground' },
  running: { label: 'executando', tone: 'text-primary' },
  retrying: { label: 'aguardando retry', tone: 'text-warning' },
  completed: { label: 'concluído', tone: 'text-success' },
  partial: { label: 'parcial', tone: 'text-warning' },
  failed: { label: 'falhou', tone: 'text-error' },
  cancelled: { label: 'cancelado', tone: 'text-muted-foreground' },
}

const KIND_LABELS: Record<string, string> = {
  bulk_create: 'Criação em massa',
  duplicate: 'Duplicação',
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function JobStatusIcon({ status }: { status: AdsOpsJob['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
  if (status === 'failed') return <XCircle className="mt-0.5 size-3.5 shrink-0 text-error" aria-hidden="true" />
  if (status === 'partial') return <OctagonAlert className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
  if (status === 'running') return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" />
  if (status === 'retrying') return <RotateCcw className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
  return <Clock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}

export function OpsDialog({
  open,
  onClose,
  currency,
  initialTab = 'jobs',
  onPolicyChanged,
}: {
  open: boolean
  onClose: () => void
  currency: string
  initialTab?: 'jobs' | 'safety'
  // revalida o badge dry-run na view principal
  onPolicyChanged?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: jobsData, mutate: mutateJobs } = useAdsOpsJobs(open)
  const { data: policyData, mutate: mutatePolicy } = useAdsSafetyPolicy(open)

  const [tab, setTab] = useState<'jobs' | 'safety'>('jobs')
  const [draft, setDraft] = useState<AdsSafetyPolicy | null>(null)
  const [saving, setSaving] = useState(false)
  useModalA11y(open, ref, saving ? () => {} : onClose)

  // Sincroniza o rascunho quando a política salva chega
  useEffect(() => {
    if (policyData?.policy) setDraft(policyData.policy)
  }, [policyData])

  useEffect(() => {
    if (open) setTab(initialTab)
  }, [open, initialTab])

  if (!open) return null

  const jobs = jobsData?.jobs ?? []
  const durable = jobsData?.enabled !== false

  async function handleSavePolicy() {
    if (!draft) return
    setSaving(true)
    try {
      const r = await apiSend<{ policy: AdsSafetyPolicy }>('/api/ads/ops/safety-policy', 'PUT', draft)
      mutatePolicy({ enabled: true, policy: r.policy }, { revalidate: false })
      onPolicyChanged?.()
      toast.success('Política de segurança salva', {
        hint: r.policy.killSwitch
          ? 'Tudo pausado: nenhuma ação é publicada no TikTok.'
          : r.policy.dryRun
            ? 'Modo teste ativo: nada é publicado no TikTok.'
            : 'Ações liberadas dentro dos limites definidos.',
      })
    } catch (e) {
      toast.error('Falha ao salvar a política', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  function patch(p: Partial<AdsSafetyPolicy>) {
    setDraft((prev) => (prev ? { ...prev, ...p } : prev))
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        disabled={saving}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ads-ops-title" tabIndex={-1} className="anim-pop-in relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl outline-none">
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <ListChecks className="size-4 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ads-ops-title" className="text-sm font-semibold text-foreground">
                Operações
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Jobs duráveis e guardrails de segurança da conta
              </p>
            </div>
          </div>
          <div className="flex gap-0.5 rounded-full bg-[var(--hover)] p-0.5" role="tablist" aria-label="Seções">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'jobs'}
              onClick={() => setTab('jobs')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'jobs' ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground'}`}
            >
              Jobs{jobs.length > 0 && ` (${jobs.length})`}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'safety'}
              onClick={() => setTab('safety')}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${tab === 'safety' ? 'bg-[var(--active)] text-foreground' : 'text-muted-foreground'}`}
            >
              Segurança
            </button>
          </div>
          <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={saving} aria-label="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === 'jobs' ? (
            <div className="flex flex-col gap-2">
              {!durable && (
                <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-pretty text-[11px] leading-relaxed text-warning">
                  Persistência durável indisponível (banco não configurado). Os jobs abaixo vivem só em
                  memória e são perdidos ao reiniciar o servidor.
                </p>
              )}
              {jobs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-xs leading-relaxed text-muted-foreground">
                  Nenhum job ainda. Criações em massa e duplicações aparecem aqui com progresso e erros —
                  mesmo depois de reiniciar o servidor.
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5" aria-label="Jobs duráveis">
                  {jobs.map((j) => {
                    const meta = STATUS_META[j.status] ?? STATUS_META.queued
                    const total = Number(j.progress?.total) || 0
                    const completed = Number(j.progress?.completed) || 0
                    const failed = Number(j.progress?.failed) || 0
                    return (
                      <li
                        key={j.id}
                        className="flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                      >
                        <JobStatusIcon status={j.status} />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-foreground">
                            {KIND_LABELS[j.kind] ?? j.kind}
                            {j.advertiser_id && (
                              <span className="ml-1.5 font-normal text-muted-foreground">
                                conta {j.advertiser_id}
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {total > 0 && `${completed}/${total} ok${failed > 0 ? ` · ${failed} falha(s)` : ''} · `}
                            {j.attempts > 1 && `${j.attempts} tentativas · `}
                            {fmtWhen(j.created_at)}
                          </p>
                          {j.error && <p className="mt-0.5 text-pretty text-[11px] text-error">{j.error}</p>}
                        </div>
                        <span className={`shrink-0 text-[11px] font-medium ${meta.tone}`}>{meta.label}</span>
                      </li>
                    )
                  })}
                </ul>
              )}
              <button type="button" className="btn-ghost self-end text-xs" onClick={() => mutateJobs()}>
                <RotateCcw className="size-3.5" aria-hidden="true" />
                Atualizar
              </button>
            </div>
          ) : !draft ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {/* Kill switch — destaque máximo */}
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${draft.killSwitch ? 'border-error/40 bg-error/10' : 'border-border bg-secondary/30'}`}
              >
                <input
                  type="checkbox"
                  checked={draft.killSwitch}
                  onChange={(e) => patch({ killSwitch: e.target.checked })}
                  className="mt-0.5 size-4 accent-[color:var(--error)]"
                  aria-label="Pausar tudo"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                    <OctagonAlert className="size-3.5 text-error" aria-hidden="true" />
                    Pausar tudo (emergência)
                  </span>
                  <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    Bloqueia TODAS as ações (criar, duplicar, pausar, orçamento) — manuais, do robô e da
                    IA. Use em emergência.
                  </span>
                </span>
              </label>

              {/* Modo teste */}
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 transition-colors ${draft.dryRun ? 'border-warning/40 bg-warning/10' : 'border-border bg-secondary/30'}`}
              >
                <input
                  type="checkbox"
                  checked={draft.dryRun}
                  onChange={(e) => patch({ dryRun: e.target.checked })}
                  className="mt-0.5 size-4 accent-[color:var(--warning)]"
                  aria-label="Modo teste"
                />
                <span className="flex flex-col gap-0.5">
                  <span className="text-xs font-semibold text-foreground">Modo teste — nada é publicado no TikTok</span>
                  <span className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                    O robô roda de ponta a ponta mas NADA é publicado no TikTok. Ideal para testar pilotos
                    e lotes antes de liberar de verdade.
                  </span>
                </span>
              </label>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Teto de gasto diário ({currency})</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={draft.dailySpendCap ?? ''}
                    onChange={(e) => patch({ dailySpendCap: e.target.value === '' ? null : Number(e.target.value) })}
                    placeholder="Sem limite"
                    aria-label="Teto de gasto diário"
                  />
                  <span className="text-[11px] text-muted-foreground">Vazio = sem teto</span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Mudança máx. de orçamento (%)</span>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={draft.maxBudgetChangePct}
                    onChange={(e) => patch({ maxBudgetChangePct: Number(e.target.value) || 20 })}
                    aria-label="Mudança máxima de orçamento em porcentagem"
                  />
                  <span className="text-[11px] text-muted-foreground">Por ação de automação/IA</span>
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-foreground">Máx. de ações/hora</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    step={1}
                    className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
                    value={draft.maxActionsPerHour ?? 10}
                    onChange={(e) => patch({ maxActionsPerHour: e.target.value === '' ? 0 : Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    aria-label="Máximo de ações automáticas por hora"
                  />
                  <span className="text-[11px] text-muted-foreground">Anti-loop do robô. 0 = sem limite</span>
                </label>
              </div>

              <p className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-pretty text-[11px] leading-relaxed text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden="true" />
                Cada alteração desta política fica registrada na trilha de auditoria com antes/depois.
              </p>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-3">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Fechar
          </button>
          {tab === 'safety' && (
            <button type="button" className="btn-primary text-xs" onClick={handleSavePolicy} disabled={saving || !draft}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Salvar política
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
