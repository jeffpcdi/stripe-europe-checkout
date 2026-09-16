'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock, Loader2, RotateCcw, X, XCircle } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DialogPortal } from '@/components/ui/dialog-portal'
import { apiSend, useAdsOpsJobs, useAdsSafetyPolicy } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsOpsJob, AdsSafetyPolicy } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const STATUS_META: Record<AdsOpsJob['status'], { label: string; tone: string }> = {
  queued: { label: 'Na fila', tone: 'text-muted-foreground' },
  running: { label: 'Executando', tone: 'text-primary' },
  retrying: { label: 'Aguardando nova tentativa', tone: 'text-warning' },
  completed: { label: 'Concluído', tone: 'text-success' },
  partial: { label: 'Parcial', tone: 'text-warning' },
  failed: { label: 'Falhou', tone: 'text-error' },
  cancelled: { label: 'Cancelado', tone: 'text-muted-foreground' },
}
const KIND_LABELS: Record<string, string> = { bulk_create: 'Criação em massa', duplicate: 'Duplicação' }

function fmtWhen(iso: string) { try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return iso } }
function normalizePolicyForCompare(value: AdsSafetyPolicy | null | undefined) {
  if (!value) return null
  return {
    ...value,
    blockedAdvertiserIds: [...new Set((value.blockedAdvertiserIds ?? []).map(String))].sort(),
  }
}
function samePolicy(a: AdsSafetyPolicy | null | undefined, b: AdsSafetyPolicy | null | undefined) {
  return JSON.stringify(normalizePolicyForCompare(a)) === JSON.stringify(normalizePolicyForCompare(b))
}

export function OpsDialog({ open, onClose, advertiserId, currency, initialTab = 'jobs', onPolicyChanged }: { open: boolean; onClose: () => void; advertiserId: string; currency: string; initialTab?: 'jobs' | 'safety'; onPolicyChanged?: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data: jobsData, mutate: mutateJobs, error: jobsError, isLoading: jobsLoading } = useAdsOpsJobs(open, advertiserId)
  const { data: policyData, mutate: mutatePolicy, error: policyError } = useAdsSafetyPolicy(open)
  const [tab, setTab] = useState<'jobs' | 'safety'>('jobs')
  const [draft, setDraft] = useState<AdsSafetyPolicy | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const isDirty = useMemo(() => Boolean(draft && policyData?.policy && !samePolicy(draft, policyData.policy)), [draft, policyData?.policy])
  const currentAdvertiserBlocked = Boolean(draft?.blockedAdvertiserIds.map(String).includes(String(advertiserId)))
  const valid = Boolean(draft && (!draft.enabled || draft.killSwitch || draft.maxActionsPerHour > 0))
  useModalA11y(open, ref, saving ? () => {} : () => requestClose())

  useEffect(() => { if (policyData?.policy && !isDirty) setDraft(policyData.policy) }, [policyData?.policy])
  useEffect(() => { if (open) { setTab(initialTab); setDraft(policyData?.policy ?? null); setConfirmDiscard(false) } }, [open, initialTab])
  if (!open) return null

  const jobs = jobsData?.jobs ?? []
  const durable = jobsData?.enabled !== false

  function requestClose() { if (isDirty) setConfirmDiscard(true); else onClose() }
  function patch(value: Partial<AdsSafetyPolicy>) { setDraft((prev) => prev ? { ...prev, ...value } : prev) }
  function setCurrentAdvertiserBlocked(blocked: boolean) {
    if (!draft || !advertiserId) return
    const current = draft.blockedAdvertiserIds.map(String)
    patch({ blockedAdvertiserIds: blocked ? [...new Set([...current, String(advertiserId)])] : current.filter((id) => id !== String(advertiserId)) })
  }

  async function handleSavePolicy() {
    if (!draft || saving || policyError || !isDirty || !valid) return
    setSaving(true)
    try {
      const r = await apiSend<{ policy: AdsSafetyPolicy }>('/api/ads/ops/safety-policy', 'PUT', draft)
      mutatePolicy({ enabled: true, policy: r.policy }, { revalidate: false }); setDraft(r.policy); onPolicyChanged?.()
      toast.success('Política de segurança salva', { hint: r.policy.killSwitch ? 'Novas ações bloqueadas. Campanhas já ativas continuam veiculando.' : r.policy.dryRun ? 'Modo teste ativo: ações são simuladas.' : 'Ações liberadas dentro dos limites definidos.' })
    } catch (e) { toast.error('Falha ao salvar a política', { hint: e instanceof Error ? e.message : undefined }) } finally { setSaving(false) }
  }

  const effectiveState = !draft ? null : draft.killSwitch
    ? { title: 'Novas ações bloqueadas', detail: 'O kill switch prevalece sobre o modo teste. Campanhas já ativas continuam veiculando.', tone: 'text-error' }
    : !draft.enabled ? { title: 'Política desativada', detail: 'Operações protegidas ficam bloqueadas enquanto a política estiver desativada.', tone: 'text-warning' }
    : draft.dryRun ? { title: 'Modo teste', detail: 'Ações são simuladas e nenhuma alteração é publicada no TikTok.', tone: 'text-warning' }
    : currentAdvertiserBlocked ? { title: 'Esta conta está bloqueada', detail: 'Novos ajustes protegidos nesta conta estão bloqueados.', tone: 'text-warning' }
    : { title: 'Ações liberadas', detail: 'Novas ações podem ocorrer dentro dos limites configurados abaixo.', tone: 'text-success' }

  return <>
    <DialogPortal><div className="ads-dialog fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background/80 p-3 backdrop-blur-sm sm:p-4">
      <button type="button" className="absolute inset-0 cursor-default" onClick={requestClose} disabled={saving} aria-label="Fechar" tabIndex={-1} />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ads-ops-title" tabIndex={-1} className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-5"><div><h2 id="ads-ops-title" className="text-base font-semibold text-foreground">Operações</h2><p className="mt-1 text-xs text-muted-foreground">Acompanhe tarefas duráveis e configure os limites que protegem novas ações.</p></div><button type="button" className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground" onClick={requestClose} disabled={saving} aria-label="Fechar"><X className="size-4" /></button></div>
        <div className="flex gap-5 border-b border-border/60 px-4 pt-3 sm:px-5" role="tablist" aria-label="Seções"><button type="button" role="tab" aria-selected={tab === 'jobs'} onClick={() => setTab('jobs')} className={`border-b-2 pb-2 text-sm font-medium ${tab === 'jobs' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>Tarefas{jobs.length ? ` (${jobs.length})` : ''}</button><button type="button" role="tab" aria-selected={tab === 'safety'} onClick={() => setTab('safety')} className={`border-b-2 pb-2 text-sm font-medium ${tab === 'safety' ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}>Segurança</button></div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {tab === 'jobs' ? <div className="space-y-4">
            {!durable && <div className="border-y border-warning/30 py-3"><p className="text-sm font-medium text-warning">Persistência durável indisponível</p><p className="mt-1 text-xs text-muted-foreground">Sem o banco configurado, tarefas em memória podem ser perdidas ao reiniciar o servidor.</p></div>}
            {jobsError ? <div><p className="text-sm text-warning">Não foi possível carregar as tarefas.</p><button type="button" className="btn-secondary mt-3 min-h-10 text-xs" onClick={() => mutateJobs()}>Tentar novamente</button></div> : jobsLoading ? <p className="py-6 text-xs text-muted-foreground">Carregando tarefas…</p> : jobs.length === 0 ? <div className="py-7 text-center"><p className="text-sm font-medium text-foreground">Nenhuma tarefa por aqui</p><p className="mt-1 text-xs text-muted-foreground">Criações em massa e duplicações aparecem aqui com progresso, tentativas e erros.</p></div> : <ul className="divide-y divide-border/50 border-y border-border/60">{jobs.map((j) => { const meta = STATUS_META[j.status] ?? STATUS_META.queued; const total = Number(j.progress?.total) || 0; const completed = Number(j.progress?.completed) || 0; const failed = Number(j.progress?.failed) || 0; return <li key={j.id} className="flex items-start gap-3 py-3"><div className="mt-0.5">{j.status === 'completed' ? <CheckCircle2 className="size-4 text-success" /> : j.status === 'failed' ? <XCircle className="size-4 text-error" /> : j.status === 'running' ? <Loader2 className="size-4 animate-spin text-primary" /> : <Clock className="size-4 text-muted-foreground" />}</div><div className="min-w-0 flex-1"><p className="text-sm font-medium text-foreground">{KIND_LABELS[j.kind] ?? j.kind}</p><p className="mt-1 text-xs text-muted-foreground">{total > 0 ? `${completed}/${total} concluídas${failed ? ` · ${failed} falha${failed === 1 ? '' : 's'}` : ''} · ` : ''}{j.attempts > 1 ? `${j.attempts} tentativas · ` : ''}{fmtWhen(j.created_at)}</p>{j.error && <p className="mt-1 text-xs text-error">{j.error}</p>}</div><span className={`shrink-0 text-xs ${meta.tone}`}>{meta.label}</span></li>})}</ul>}
            <div className="flex justify-end"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => mutateJobs()}><RotateCcw className="size-3.5" />Atualizar</button></div>
          </div> : policyError ? <div><p className="text-sm text-warning">Não foi possível carregar os limites de segurança.</p><button type="button" className="btn-secondary mt-3 min-h-10 text-xs" onClick={() => mutatePolicy()}>Tentar novamente</button></div> : !draft ? <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-muted-foreground" /></div> : <div className="space-y-6">
            {effectiveState && <section className="border-b border-border/60 pb-4"><p className="text-xs font-medium text-muted-foreground">Estado atual</p><p className={`mt-1 text-sm font-semibold ${effectiveState.tone}`}>{effectiveState.title}</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{effectiveState.detail}</p></section>}

            <section><h3 className="text-sm font-semibold text-foreground">Proteção</h3><div className="mt-2 divide-y divide-border/50 border-y border-border/60">{[
              { label: 'Política ativa', detail: 'Necessária para operações protegidas e automações.', checked: draft.enabled, onChange: (v:boolean) => patch({ enabled: v }), tone: 'primary' },
              { label: 'Bloquear esta conta', detail: 'Impede novos ajustes protegidos nesta conta.', checked: currentAdvertiserBlocked, onChange: setCurrentAdvertiserBlocked, tone: 'warning' },
              { label: 'Bloquear novas ações', detail: 'Interrompe novas ações protegidas. Campanhas já ativas continuam veiculando.', checked: draft.killSwitch, onChange: (v:boolean) => patch({ killSwitch: v }), tone: 'error' },
              { label: 'Modo teste', detail: 'Simula ações sem publicar alterações no TikTok.', checked: draft.dryRun, onChange: (v:boolean) => patch({ dryRun: v }), tone: 'warning' },
            ].map((item) => <label key={item.label} className="flex cursor-pointer items-start gap-3 py-3"><input type="checkbox" className="mt-0.5 size-4" checked={item.checked} onChange={(e) => item.onChange(e.target.checked)} /><span><span className="text-sm font-medium text-foreground">{item.label}</span><span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{item.detail}</span></span></label>)}</div></section>

            <section><h3 className="text-sm font-semibold text-foreground">Limites</h3><div className="mt-3 grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Teto diário para automações ({currency})</span><input type="number" min={0} step="0.01" className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={draft.dailySpendCap ?? ''} onChange={(e) => patch({ dailySpendCap: e.target.value === '' ? null : Number(e.target.value) })} placeholder="Sem teto" /><span className="text-xs leading-relaxed text-muted-foreground">Impede aumentos automáticos que fariam o orçamento diário agregado ultrapassar este valor.</span></label>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Mudança máxima de orçamento (%)</span><input type="number" min={1} max={100} className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={draft.maxBudgetChangePct} onChange={(e) => patch({ maxBudgetChangePct: Number(e.target.value) || 20 })} /><span className="text-xs leading-relaxed text-muted-foreground">Limite máximo permitido para um único ajuste de orçamento.</span></label>
              <label className="flex flex-col gap-1.5 sm:col-span-2"><span className="text-xs font-medium text-foreground">Máximo de ações por hora</span><input type="number" min={1} max={1000} step={1} className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm sm:max-w-xs" value={draft.maxActionsPerHour ?? 10} onChange={(e) => patch({ maxActionsPerHour: e.target.value === '' ? 10 : Math.max(1, Math.floor(Number(e.target.value) || 10)) })} /><span className="text-xs leading-relaxed text-muted-foreground">Anti-loop. Interrompe ações automáticas repetidas ao atingir este limite.</span></label>
            </div></section>
            {isDirty && <p className="text-xs font-medium text-warning">Alterações não salvas</p>}
          </div>}
        </div>

        <div className="flex flex-col gap-2 border-t border-border/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5"><p className="text-xs text-muted-foreground">{tab === 'safety' ? 'As mudanças abaixo só entram em vigor depois de salvar.' : 'Tarefas duráveis continuam no servidor mesmo com esta janela fechada.'}</p><div className="flex justify-end gap-2"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={requestClose}>Fechar</button>{tab === 'safety' && <button type="button" className="btn-primary min-h-10 text-xs" onClick={handleSavePolicy} disabled={saving || !draft || !isDirty || !valid}>{saving && <Loader2 className="size-3.5 animate-spin" />}Salvar política</button>}</div></div>
      </div>
    </div></DialogPortal>
    <ConfirmDialog open={confirmDiscard} title="Descartar alterações?" description="As mudanças feitas na política ainda não foram salvas." confirmLabel="Descartar" appearance="quiet" tone="danger" onConfirm={() => { setConfirmDiscard(false); onClose() }} onClose={() => setConfirmDiscard(false)} />
  </>
}
