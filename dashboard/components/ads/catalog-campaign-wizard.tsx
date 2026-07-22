'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, Rocket, RotateCcw, Trash2 } from 'lucide-react'
import {
  adsCatalogApiUrl, adsCreateCatalogCampaign, adsPreflightCatalogCampaign, apiSend,
  useAdsCatalogCampaignRuns,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import { resolveStableIdempotencyKey, type StableIdempotencyState } from '@/lib/stable-idempotency'
import type { AdsCatalog, AdsCatalogCampaignRun, AdsCatalogCapabilities } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { TIKTOK_CTA_OPTIONS, TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import { CatalogQuickCampaignsDialog } from './catalog-quick-campaigns-dialog'

const STAGES: Record<string, string> = {
  queued: 'Na fila', validating: 'Validando pré-requisitos', creating_campaign: 'Criando campanha',
  creating_adgroup: 'Criando conjunto', creating_ad: 'Criando anúncio',
  verifying_entities: 'Verificando a hierarquia', ready_paused: 'Pronta e pausada',
  waiting_connector_confirmation: 'Aguardando confirmação Product Link',
  waiting_catalog_review: 'Aguardando aprovação do catálogo',
  campaign: 'Criação da campanha', adgroup: 'Criação do conjunto', ad: 'Criação do anúncio', verify: 'Verificação',
}

const RUN_STATUS: Record<AdsCatalogCampaignRun['status'], string> = {
  queued: 'Na fila', waiting_connector_confirmation: 'Aguardando conector', waiting_catalog_review: 'Aguardando catálogo', running: 'Em andamento', retrying: 'Tentando novamente',
  completed: 'Concluída', partial: 'Parcial', failed: 'Falhou', cancelled: 'Cancelada',
}

function RunCard({
  run,
  advertiserId,
  currency,
  mutate,
}: {
  run: AdsCatalogCampaignRun
  advertiserId: string
  currency: string
  mutate: () => void
}) {
  const active = ['queued', 'waiting_connector_confirmation', 'waiting_catalog_review', 'running', 'retrying'].includes(run.status)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const campaignName = String(run.spec.name || 'Campanha sem nome')
  const scope = String(run.spec.productScope || 'all')
  const ids = Array.isArray(run.spec.productIds) ? run.spec.productIds : []
  const scopeLabel = scope === 'specific'
    ? `${ids.length} produto(s) específico(s)`
    : scope === 'product_set'
      ? `Product set ${String(run.spec.productSetId || 'informado')}`
      : 'Todos os produtos'
  const budgetAmount = Number(run.spec.budgetAmount)
  const budgetLabel = Number.isFinite(budgetAmount) && budgetAmount > 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(budgetAmount) + '/dia'
    : null
  const verification = run.result && typeof run.result.verification === 'object' && run.result.verification !== null
    ? run.result.verification as Record<string, unknown>
    : null
  const verificationLabels = verification ? [
    verification.hierarchy === true && 'hierarquia completa',
    verification.productLink === true && 'Product Link',
    verification.targeting === true && 'Pixel e evento',
    verification.identity === true && 'identidade do Business Center',
    verification.creative === true && 'Catalog Carousel',
    verification.noManualUrl === true && 'sem URL manual',
    verification.paused === true && 'tudo pausado',
  ].filter(Boolean) as string[] : []
  const warnings = run.result && Array.isArray(run.result.warnings)
    ? run.result.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim()))
    : []
  const failed = run.status === 'partial' || run.status === 'failed'
  const canResume = failed && run.error?.retryable !== false
  async function action(kind: 'resume' | 'cleanup') {
    setActionBusy(true)
    try {
      await apiSend(adsCatalogApiUrl(`/api/ads/catalog-campaign-runs/${encodeURIComponent(run.id)}/${kind}`, advertiserId), 'POST', {})
      toast.success(kind === 'resume' ? 'Criação colocada novamente na fila' : 'Estrutura parcial removida')
      mutate()
    } catch (error) {
      toast.error('Ação não concluída', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setActionBusy(false)
      setConfirmCleanup(false)
    }
  }
  return (
    <>
    <div className={`rounded-lg border p-3 ${run.status === 'completed' ? 'border-success/30 bg-success/5' : run.status === 'partial' || run.status === 'failed' ? 'border-error/30 bg-error/5' : 'border-border bg-card'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground" title={campaignName}>{campaignName}</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
            {active ? <Loader2 className="size-3.5 animate-spin text-primary" /> : run.status === 'completed' ? <Check className="size-3.5 text-success" /> : <AlertCircle className="size-3.5 text-error" />}
            {STAGES[run.stage] || run.stage}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">{scopeLabel}{budgetLabel ? ` · ${budgetLabel}` : ''}</p>
          {(run.createdIds.campaignId || run.createdIds.adGroupId || run.createdIds.adId) && (
            <p className="mt-1 break-all text-[10px] text-muted-foreground">Campanha {run.createdIds.campaignId || '—'} · Conjunto {run.createdIds.adGroupId || '—'} · Anúncio {run.createdIds.adId || '—'}</p>
          )}
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{RUN_STATUS[run.status]}</span>
      </div>
      {verificationLabels.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-success/20 bg-success/5 p-2 text-[10px] leading-relaxed text-success">
          <Check className="mt-0.5 size-3 shrink-0" /> Estrutura Product Link verificada: {verificationLabels.join(' · ')}
        </p>
      )}
      {warnings.length > 0 && (
        <div className="mt-2 rounded-lg border border-warning/20 bg-warning/5 p-2 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-warning">Avisos da criação</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {warnings.map((warning, index) => <li key={`${warning}:${index}`}>{warning}</li>)}
          </ul>
        </div>
      )}
      {run.error && (
        <div className="mt-2 rounded-lg bg-background/70 p-2 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-error">{run.error.userMessage}</p>
          {run.error.suggestedAction && <p className="mt-1">{run.error.suggestedAction}</p>}
        </div>
      )}
      {failed && (canResume || Boolean(run.createdIds.campaignId)) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {canResume && <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => action('resume')} disabled={actionBusy}><RotateCcw className="size-3.5" /> Retomar</button>}
          {run.createdIds.campaignId && <button type="button" className="btn-ghost !py-1.5 text-xs text-error" onClick={() => setConfirmCleanup(true)} disabled={actionBusy}><Trash2 className="size-3.5" /> Excluir parcial</button>}
        </div>
      )}
    </div>
    <ConfirmDialog
      open={confirmCleanup}
      title="Excluir estrutura parcial?"
      description="A campanha e os recursos que já foram criados por esta tentativa serão removidos do TikTok. Use Retomar se quiser continuar de onde parou."
      confirmLabel="Excluir parcial"
      busy={actionBusy}
      onConfirm={() => action('cleanup')}
      onClose={() => setConfirmCleanup(false)}
    />
    </>
  )
}

export function CatalogCampaignWizard({
  catalog,
  advertiserId,
  ready,
  capabilities,
}: {
  catalog: AdsCatalog
  advertiserId: string
  ready: boolean
  capabilities: AdsCatalogCapabilities | null
}) {
  const supported = capabilities?.manualCatalogCampaign === true
  const supportsAdText = supported && capabilities?.adText === true
  const supportsCallToAction = supported && capabilities?.callToAction === true
  const creativeFormat = capabilities?.adFormat === 'CATALOG_CAROUSEL'
    ? 'Catalog Carousel'
    : capabilities?.adFormat || 'formato ainda não confirmado'
  const { data: runsData, mutate: mutateRuns } = useAdsCatalogCampaignRuns(catalog.id, advertiserId)
  const runs = runsData?.runs ?? []
  const [open, setOpen] = useState(false)
  const [batchOpen, setBatchOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(catalog.name)
  const [budget, setBudget] = useState('')
  const [text, setText] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')
  const idempotencyRef = useRef<StableIdempotencyState | null>(null)

  const activeRun = useMemo(() => runs.find((run) => ['queued', 'waiting_connector_confirmation', 'waiting_catalog_review', 'running', 'retrying'].includes(run.status)), [runs])
  const availableCtas = useMemo(() => {
    if (!supportsCallToAction) return []
    const declared = new Set((capabilities?.callToActions ?? []).map((value) => value.toUpperCase()))
    const matching = TIKTOK_CTA_OPTIONS.filter((option) => declared.has(option.value))
    return matching.length > 0 ? matching : TIKTOK_CTA_OPTIONS
  }, [capabilities?.callToActions, supportsCallToAction])
  useEffect(() => {
    if (!supported) setOpen(false)
    if (!supportsAdText && text) setText('')
    if (!supportsCallToAction && cta !== 'SHOP_NOW') setCta('SHOP_NOW')
  }, [cta, supported, supportsAdText, supportsCallToAction, text])

  useEffect(() => {
    if (supportsCallToAction && availableCtas.length > 0 && !availableCtas.some((option) => option.value === cta)) {
      setCta(availableCtas[0].value)
    }
  }, [availableCtas, cta, supportsCallToAction])

  const materialSignature = useMemo(() => JSON.stringify({
    catalogId: catalog.id,
    advertiserId,
    name: name.trim() || catalog.name,
    budget: Number(budget),
    productScope: 'all',
    text: supportsAdText ? text.trim() : '',
    cta: supportsCallToAction ? cta : '',
  }), [advertiserId, budget, catalog.id, catalog.name, cta, name, supportsAdText, supportsCallToAction, text])

  function idempotencyKey() {
    idempotencyRef.current = resolveStableIdempotencyKey(
      idempotencyRef.current,
      materialSignature,
      () => typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `${catalog.id}:${Date.now()}:${Math.random().toString(16).slice(2)}`,
    )
    return idempotencyRef.current.key
  }

  function payload() {
    const body: Record<string, unknown> = {
      adAccountId: advertiserId,
      name: name.trim() || catalog.name,
      budgetAmount: Number(budget), budgetType: 'daily', budgetOptimization: 'adgroup',
      country: catalog.country || 'BR', productScope: 'all',
      idempotencyKey: idempotencyKey(),
    }
    if (supportsAdText && text.trim()) body.text = text.trim()
    if (supportsCallToAction) body.callToAction = cta
    return body
  }

  async function create() {
    if (!supported) return toast.error('A criação ainda não foi confirmada pelo conector TikTok')
    if (!(Number(budget) >= TIKTOK_MIN_BUDGET)) return toast.error(tiktokMinimumBudgetMessage(catalog.currency, ' por dia'))
    setBusy(true)
    try {
      const body = payload()
      await adsPreflightCatalogCampaign(catalog.id, advertiserId, body)
      const result = await adsCreateCatalogCampaign(catalog.id, advertiserId, body)
      idempotencyRef.current = null
      if (result.dryRun) toast.info('Modo teste: criação validada sem publicar no TikTok')
      else toast.success('Criação iniciada', { hint: 'A campanha, o conjunto e o anúncio serão verificados antes da conclusão.' })
      setOpen(false)
      await mutateRuns()
    } catch (error) {
      toast.error('Pré-validação não passou', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section id="catalog-campaign-wizard" className="scroll-mt-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Campanhas deste catálogo</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Catalog Carousel · cada produto abre o próprio Link.</p>
        </div>
        {supported ? (
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setBatchOpen(true)} disabled={!ready || Boolean(activeRun)}>
              Criar lote
            </button>
            <button type="button" className="btn-primary text-xs" onClick={() => setOpen((value) => !value)} disabled={!ready || Boolean(activeRun)}>
              <Rocket className="size-3.5" /> {activeRun ? 'Criação em andamento' : 'Nova campanha'} <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
          </div>
        ) : <span className="rounded-md border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[10px] font-medium text-warning">Conector em validação</span>}
      </div>
      {!supported && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-warning">A criação está bloqueada até o conector confirmar Catalog Carousel.</p>
          <p className="mt-1">O catálogo continua salvo e nenhuma campanha incompleta foi enviada.</p>
          <details className="mt-2 border-t border-warning/20 pt-2">
            <summary className="cursor-pointer font-medium text-muted-foreground">Detalhes técnicos</summary>
            <p className="mt-1">A dashboard preserva o Link individual de cada produto e nunca usa uma URL global como substituição.</p>
          </details>
        </div>
      )}
      {supported && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Criativo efetivo: {creativeFormat}</p>
          <p className="mt-1">Produtos, Pixel, Compra, identidade e música elegível são resolvidos antes da criação. Se faltar algo, nenhuma estrutura é enviada.</p>
        </div>
      )}
      {supported && !ready && <p className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[10px] text-warning">Conclua o checklist de prontidão antes de criar uma campanha.</p>}

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-muted-foreground">Nome<input className="input-base mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-[11px] text-muted-foreground">Orçamento diário ({catalog.currency})<input className="input-base mt-1 w-full" type="number" min={TIKTOK_MIN_BUDGET} step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="50,00" /></label>
          </div>
          <p className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-[10px] leading-relaxed text-muted-foreground">Todos os produtos aprovados entram automaticamente. Pixel, evento Compra e música própria são validados sem campos manuais.</p>
          {(supportsAdText || supportsCallToAction) && (
            <details className="rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-[11px] font-semibold text-foreground">Criativo avançado</summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {supportsAdText && <label className="text-[11px] text-muted-foreground">Texto<input className="input-base mt-1 w-full" maxLength={100} value={text} onChange={(e) => setText(e.target.value)} /></label>}
                {supportsCallToAction && <label className="text-[11px] text-muted-foreground">CTA<select className="input-base mt-1 w-full" value={cta} onChange={(e) => setCta(e.target.value)}>{availableCtas.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
              </div>
            </details>
          )}
          <p className="rounded-lg bg-secondary/60 p-2.5 text-[10px] leading-relaxed text-muted-foreground">ABO · Compra · Product Link · tudo nasce pausado. Não existe URL manual no anúncio.</p>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="btn-primary text-xs" onClick={create} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Pré-validar e criar</button></div>
        </div>
      )}

      {runs.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          <p className="text-[10px] font-medium text-muted-foreground">Histórico recente · {runs.length} campanha(s)</p>
          {runs.slice(0, 20).map((run) => (
            <RunCard key={run.id} run={run} advertiserId={advertiserId} currency={catalog.currency} mutate={() => { void mutateRuns() }} />
          ))}
        </div>
      )}
      <CatalogQuickCampaignsDialog
        catalog={catalog}
        advertiserId={advertiserId}
        open={supported && batchOpen}
        onClose={() => setBatchOpen(false)}
        onCreated={() => { void mutateRuns() }}
      />
    </section>
  )
}
