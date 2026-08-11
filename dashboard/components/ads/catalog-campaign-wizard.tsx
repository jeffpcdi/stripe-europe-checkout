'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Check, Loader2, Rocket, RotateCcw, Trash2 } from 'lucide-react'
import { adsCatalogApiUrl, apiSend, useAdsCatalogCampaignRuns } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogCampaignRun, AdsCatalogCapabilities } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { CatalogQuickCampaignsDialog } from './catalog-quick-campaigns-dialog'

const STAGES: Record<string, string> = {
  queued: 'Na fila', validating: 'Validando pré-requisitos',
  upload: 'Processando vídeo', cover: 'Preparando capa do vídeo',
  creating_campaign: 'Criando campanha',
  creating_adgroup: 'Criando conjunto', creating_ad: 'Criando anúncio',
  verifying_entities: 'Verificando a hierarquia', ready_paused: 'Pronta e pausada',
  waiting_pixel_purchase: 'Aguardando o Pixel', activating: 'Ativando a hierarquia', ready_active: 'Ativa no TikTok',
  waiting_tiktok_confirmation: 'Confirmando no TikTok',
  waiting_connector_confirmation: 'Aguardando confirmação Product Link',
  waiting_catalog_review: 'Aguardando aprovação do catálogo',
  campaign: 'Criação da campanha', adgroup: 'Criação do conjunto', ad: 'Criação do anúncio', verify: 'Verificação',
}

const RUN_STATUS: Record<AdsCatalogCampaignRun['status'], string> = {
  queued: 'Na fila', waiting_connector_confirmation: 'Aguardando conector', waiting_catalog_review: 'Aguardando catálogo',
  waiting_pixel_purchase: 'Aguardando Pixel',
  waiting_tiktok_confirmation: 'Confirmando', running: 'Em andamento', retrying: 'Tentando novamente',
  completed: 'Concluída', partial: 'Parcial', failed: 'Falhou', cancelled: 'Cancelada',
}

const ACTIVE_STATUSES: AdsCatalogCampaignRun['status'][] = [
  'queued', 'waiting_connector_confirmation', 'waiting_catalog_review',
  'waiting_pixel_purchase', 'waiting_tiktok_confirmation', 'running', 'retrying',
]

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
  const active = ACTIVE_STATUSES.includes(run.status)
  const [confirmCleanup, setConfirmCleanup] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const requestedCampaignName = String(run.spec.name || 'Campanha sem nome')
  const campaignName = String(run.result?.name || run.createdIds.campaignName || requestedCampaignName)
  const campaignWasRenamed = campaignName !== requestedCampaignName
  const scope = String(run.spec.productScope || 'all')
  const ids = Array.isArray(run.spec.productIds) ? run.spec.productIds : []
  const scopeLabel = scope === 'specific'
    ? `${ids.length} produto(s) específico(s)`
    : scope === 'product_set'
      ? `Product set ${String(run.spec.productSetId || 'informado')}`
      : 'Todos os produtos aprovados'
  const budgetAmount = Number(run.spec.budgetAmount)
  const budgetLabel = Number.isFinite(budgetAmount) && budgetAmount > 0
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(budgetAmount) + '/dia'
    : null
  const bidLabel = run.spec.bidStrategy === 'cost_cap'
    ? `Custo-alvo ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(Number(run.spec.bidAmount) || 0)}`
    : 'Máxima entrega'
  const deliveryLabel = run.spec.deliveryMode === 'accelerated' ? 'entrega acelerada' : 'entrega padrão'
  const verification = run.result && typeof run.result.verification === 'object' && run.result.verification !== null
    ? run.result.verification as Record<string, unknown>
    : null
  const verificationLabels = verification ? [
    verification.hierarchy === true && 'hierarquia completa',
    verification.productLink === true && 'Product Link',
    verification.targeting === true && 'Pixel e evento',
    verification.bidDelivery === true && 'lance e entrega',
    verification.identity === true && 'identidade do Business Center',
    verification.creative === true && 'vídeo vertical',
    verification.noManualUrl === true && 'sem URL manual',
    verification.paused === true && 'tudo pausado',
  ].filter(Boolean) as string[] : []
  const activation = run.result && typeof run.result.activation === 'object' && run.result.activation !== null
    ? run.result.activation as Record<string, unknown>
    : null
  const activeOnTikTok = activation?.complete === true && activation?.active === true
  const warnings = run.result && Array.isArray(run.result.warnings)
    ? run.result.warnings.filter((warning): warning is string => typeof warning === 'string' && Boolean(warning.trim()))
    : []
  const failed = run.status === 'partial' || run.status === 'failed'
  const canResume = failed && run.error?.retryable !== false
  const onlyVideoPrepared = Boolean(run.createdIds.videoId && !run.createdIds.campaignId)
  const runStatusLabel = run.status === 'partial' && onlyVideoPrepared
    ? 'Vídeo preparado'
    : RUN_STATUS[run.status]

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
      <div className={`rounded-lg border p-3 ${run.status === 'completed' ? 'border-success/30 bg-success/5' : failed ? 'border-error/30 bg-error/5' : 'border-border bg-card'}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground" title={campaignName}>{campaignName}</p>
            {campaignWasRenamed && (
              <p className="mt-0.5 text-[10px] text-primary">Nome ajustado automaticamente para não duplicar</p>
            )}
            <p className="mt-1 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              {active ? <Loader2 className="size-3.5 animate-spin text-primary" /> : run.status === 'completed' ? <Check className="size-3.5 text-success" /> : <AlertCircle className="size-3.5 text-error" />}
              {STAGES[run.stage] || run.stage}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">{scopeLabel}{budgetLabel ? ` · ${budgetLabel}` : ''} · {bidLabel} · {deliveryLabel}</p>
          </div>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{runStatusLabel}</span>
        </div>
        {verificationLabels.length > 0 && (
          <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-success/20 bg-success/5 p-2 text-[10px] leading-relaxed text-success">
            <Check className="mt-0.5 size-3 shrink-0" /> {activeOnTikTok
              ? 'Ativa. Campanha, conjunto, anúncio, produtos, vídeo e destino foram confirmados no TikTok.'
              : 'Pronta e pausada. Produtos, vídeo e destino foram confirmados no TikTok.'}
          </p>
        )}
        {run.status === 'waiting_pixel_purchase' && (
          <p className="mt-2 rounded-lg border border-warning/25 bg-warning/5 p-2 text-[10px] leading-relaxed text-warning">
            Pedido salvo. A dashboard consulta o Pixel em segundo plano e iniciará a criação automaticamente quando o TikTok reconhecer a atividade e a Compra reais.
          </p>
        )}
        {run.error && !active && (
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
        {(run.error || run.createdIds.videoId || run.createdIds.coverImageId || run.createdIds.campaignId || verificationLabels.length > 0 || warnings.length > 0) && (
          <details className="mt-2 rounded-lg border border-border/70 px-2.5 py-2 text-[10px] text-muted-foreground">
            <summary className="cursor-pointer font-medium">Detalhes técnicos</summary>
            {run.error && (
              <p className="mt-2 break-words">
                Erro {run.error.code} · {run.error.message}
                {run.error.providerRequestId ? ` · Solicitação ${run.error.providerRequestId}` : ''}
              </p>
            )}
            {(run.createdIds.videoId || run.createdIds.coverImageId) && (
              <p className="mt-1 break-all">Vídeo {run.createdIds.videoId || '—'} · Capa {run.createdIds.coverImageId || 'aguardando'}</p>
            )}
            {(run.createdIds.campaignId || run.createdIds.adGroupId || run.createdIds.adId) && (
              <p className="mt-1 break-all">Campanha {run.createdIds.campaignId || '—'} · Conjunto {run.createdIds.adGroupId || '—'} · Anúncio {run.createdIds.adId || '—'}</p>
            )}
            {verificationLabels.length > 0 && <p className="mt-1">Verificado: {verificationLabels.join(' · ')}</p>}
            {warnings.length > 0 && <ul className="mt-1 list-disc space-y-0.5 pl-4">{warnings.map((warning, index) => <li key={`${warning}:${index}`}>{warning}</li>)}</ul>}
          </details>
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
  advertiserCurrency,
  ready,
  capabilities,
}: {
  catalog: AdsCatalog
  advertiserId: string
  advertiserCurrency: string
  ready: boolean
  capabilities: AdsCatalogCapabilities | null
}) {
  const connectorReady = capabilities?.catalogSingleVideoCampaign === true
  const { data: runsData, mutate: mutateRuns } = useAdsCatalogCampaignRuns(catalog.id, advertiserId)
  const runs = runsData?.runs ?? []
  const [dialogOpen, setDialogOpen] = useState(false)
  const activeRun = useMemo(() => runs.find((run) => ACTIVE_STATUSES.includes(run.status)), [runs])
  const currentRuns = activeRun ? [activeRun] : runs.slice(0, 1)
  const previousRuns = (activeRun ? runs.filter((run) => run.id !== activeRun.id) : runs.slice(1)).slice(0, 9)
  const blockers = capabilities?.blockers ?? []

  return (
    <section id="catalog-campaign-wizard" className="scroll-mt-4 rounded-xl border border-border bg-background p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-foreground">Campanhas deste catálogo</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">Escolha o vídeo e a quantidade. O restante é automático.</p>
        </div>
        {capabilities === null
          ? <span className="rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">Carregando</span>
          : (
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={() => setDialogOpen(true)}
              disabled={!connectorReady || !ready || Boolean(activeRun)}
            >
              {activeRun ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
              {activeRun ? 'Criação em andamento' : 'Criar campanhas'}
            </button>
          )}
      </div>

      {capabilities !== null && !connectorReady && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-warning">Criação temporariamente indisponível</p>
          <p className="mt-1">Nada foi enviado. A dashboard verificará novamente o TikTok; não é necessário montar a campanha manualmente.</p>
          {blockers.length > 0 && <details className="mt-2 border-t border-warning/20 pt-2">
            <summary className="cursor-pointer font-medium text-muted-foreground">Detalhes técnicos</summary>
            <p className="mt-1 break-all">{blockers.join(' · ')}</p>
          </details>}
        </div>
      )}
      {connectorReady && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-foreground">Pronto para vídeo de catálogo</p>
          <p className="mt-1">Todos os produtos aprovados usam o próprio Link. Pixel, Compra, identidade e capa são automáticos; o áudio vem do vídeo.</p>
        </div>
      )}
      {capabilities !== null && !ready && <p className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[10px] text-warning">A dashboard ainda está validando catálogo, Pixel e conta. O botão será liberado quando tudo estiver pronto.</p>}

      {currentRuns.length > 0 && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {currentRuns.map((run) => (
            <RunCard key={run.id} run={run} advertiserId={advertiserId} currency={advertiserCurrency} mutate={() => { void mutateRuns() }} />
          ))}
        </div>
      )}
      {previousRuns.length > 0 && (
        <details className="mt-3 rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Histórico anterior ({previousRuns.length})</summary>
          <div className="mt-3 space-y-2">
            {previousRuns.map((run) => (
              <RunCard key={run.id} run={run} advertiserId={advertiserId} currency={advertiserCurrency} mutate={() => { void mutateRuns() }} />
            ))}
          </div>
        </details>
      )}
      <CatalogQuickCampaignsDialog
        catalog={catalog}
        advertiserId={advertiserId}
        advertiserCurrency={advertiserCurrency}
        capabilities={capabilities}
        open={connectorReady && dialogOpen}
        onClose={() => setDialogOpen(false)}
        onCreated={() => { void mutateRuns() }}
      />
    </section>
  )
}
