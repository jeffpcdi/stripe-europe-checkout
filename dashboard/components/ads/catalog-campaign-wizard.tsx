'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Loader2, Rocket, RotateCcw, Trash2, X, Sparkles } from 'lucide-react'
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
    <section id="catalog-campaign-wizard" className="scroll-mt-4 rounded-xl border border-border bg-background p-4 mt-3 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2"><div className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] text-primary">3</div> Lançamento</h3>
          <p className="text-[11px] text-muted-foreground ml-7">Envie a campanha para o TikTok com orçamentos predefinidos.</p>
        </div>
        {capabilities === null
          ? <span className="rounded-md border border-border bg-secondary/50 px-2.5 py-1.5 text-[10px] font-medium text-muted-foreground">Carregando</span>
          : (
            <div className="flex items-center gap-2">
              <CatalogPresetCampaignButton 
                catalogId={catalog.id} 
                advertiserId={advertiserId} 
                disabled={!connectorReady || !ready || Boolean(activeRun)}
                onCreated={() => mutateRuns()}
              />
              <button
                type="button"
                className="btn-secondary text-xs"
                onClick={() => setDialogOpen(true)}
                disabled={!connectorReady || !ready || Boolean(activeRun)}
              >
                {activeRun ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
                {activeRun ? 'Criação em andamento' : 'Criar personalizado'}
              </button>
            </div>
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
        open={dialogOpen}
        catalog={catalog}
        advertiserId={advertiserId}
        advertiserCurrency={advertiserCurrency}
        capabilities={capabilities}
        onClose={() => setDialogOpen(false)}
        onCreated={() => {
          setDialogOpen(false)
          mutateRuns()
        }}
      />
    </section>
  )
}

function CatalogPresetCampaignButton({ catalogId, advertiserId, disabled, onCreated }: { catalogId: string, advertiserId: string, disabled: boolean, onCreated: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  
  // Lê o preset do localStorage
  const getPreset = () => {
    try {
      const data = localStorage.getItem('catalog_campaign_preset')
      return data ? JSON.parse(data) : null
    } catch { return null }
  }
  
  const [preset, setPreset] = useState<any>(null)
  
  // Atualiza o preset lido quando o modal abre ou component monta
  useEffect(() => { setPreset(getPreset()) }, [open])

  async function handleLaunch(overridePreset?: any) {
    const currentPreset = overridePreset || preset
    if (!currentPreset) {
      setOpen(true)
      return
    }

    setBusy(true)
    try {
      // payload pra `/campaign-batch` (que cria apenas 1 se qtd = 1) ou `/campaign` direto
      const payload = {
        name: currentPreset.name || 'Campanha Padrão',
        budgetAmount: currentPreset.budgetAmount || 50,
        budgetType: 'daily',
        budgetOptimization: 'campaign', // CBO
        bidStrategy: currentPreset.bidStrategy || 'lowest_cost',
        deliveryMode: 'standard',
        productScope: 'all',
        videoUrl: currentPreset.videoUrl
      }
      
      await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/campaign`, advertiserId), 'POST', payload)
      
      toast.success('Campanha Padrão lançada com sucesso!')
      onCreated()
      setOpen(false)
    } catch (e) {
      toast.error('Erro ao lançar campanha', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  // Modal para definir preset
  const [videoUrl, setVideoUrl] = useState(preset?.videoUrl || '')
  const [budget, setBudget] = useState(preset?.budgetAmount || '50')
  const [name, setName] = useState(preset?.name || 'Campanha Padrão')
  
  const handleSaveAndLaunch = () => {
    const newPreset = { videoUrl, budgetAmount: Number(budget), name, bidStrategy: 'lowest_cost' }
    localStorage.setItem('catalog_campaign_preset', JSON.stringify(newPreset))
    setPreset(newPreset)
    handleLaunch(newPreset)
  }

  return (
    <>
      <div className="flex gap-2">
        <button 
          type="button" 
          className="btn-secondary text-xs" 
          onClick={() => handleLaunch()} 
          disabled={disabled || busy}
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />}
          {preset ? 'Lançar Padrão' : 'Configurar Padrão'}
        </button>
        {preset && (
          <button 
            type="button" 
            className="btn-primary text-xs bg-gradient-to-r from-indigo-500 to-purple-600 border-none text-white hover:opacity-90" 
            onClick={() => handleLaunch({ ...preset, campaignKind: 'SMART_PLUS' })} 
            disabled={disabled || busy}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
            Lançar Smart+
          </button>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-xl border border-border bg-background p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Configurar Campanha Padrão</h2>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setOpen(false)}>
                <X className="size-4" />
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Defina seu template. As próximas vezes você lançará em apenas 1 clique.
            </p>

            <div className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">Nome Base</span>
                <input type="text" className="input-base" value={name} onChange={e => setName(e.target.value)} />
              </label>
              
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">Orçamento CBO Diário</span>
                <input type="number" className="input-base" min="20" step="5" value={budget} onChange={e => setBudget(e.target.value)} />
              </label>

              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium">URL de Vídeo (Padrão)</span>
                <input type="url" className="input-base" placeholder="https://" value={videoUrl} onChange={e => setVideoUrl(e.target.value)} />
                <span className="text-[10px] text-muted-foreground">Este vídeo será a base do anúncio.</span>
              </label>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancelar</button>
              <button type="button" className="btn-primary text-xs" onClick={handleSaveAndLaunch} disabled={!videoUrl || busy}>
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
                Salvar & Lançar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
