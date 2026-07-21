'use client'

import { useMemo, useState } from 'react'
import { AlertCircle, Check, ChevronDown, Loader2, Rocket, RotateCcw, Trash2 } from 'lucide-react'
import {
  adsCreateCatalogCampaign, adsPreflightCatalogCampaign, apiSend,
  useAdsCatalogCampaignRuns,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogCampaignRun } from '@/lib/types'

const STAGES: Record<string, string> = {
  queued: 'Na fila', validating: 'Validando pré-requisitos', creating_campaign: 'Criando campanha',
  creating_adgroup: 'Criando conjunto', creating_ad: 'Criando anúncio',
  verifying_entities: 'Verificando a hierarquia', ready_paused: 'Pronta e pausada',
  campaign: 'Criação da campanha', adgroup: 'Criação do conjunto', ad: 'Criação do anúncio', verify: 'Verificação',
}

function RunCard({ run, mutate }: { run: AdsCatalogCampaignRun; mutate: () => void }) {
  const active = ['queued', 'running', 'retrying'].includes(run.status)
  async function action(kind: 'resume' | 'cleanup') {
    try {
      await apiSend(`/api/ads/catalog-campaign-runs/${encodeURIComponent(run.id)}/${kind}`, 'POST', {})
      toast.success(kind === 'resume' ? 'Criação colocada novamente na fila' : 'Estrutura parcial removida')
      mutate()
    } catch (error) {
      toast.error('Ação não concluída', { hint: error instanceof Error ? error.message : undefined })
    }
  }
  return (
    <div className={`rounded-lg border p-3 ${run.status === 'completed' ? 'border-success/30 bg-success/5' : run.status === 'partial' || run.status === 'failed' ? 'border-error/30 bg-error/5' : 'border-border bg-card'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground">
            {active ? <Loader2 className="size-3.5 animate-spin text-primary" /> : run.status === 'completed' ? <Check className="size-3.5 text-success" /> : <AlertCircle className="size-3.5 text-error" />}
            {STAGES[run.stage] || run.stage}
          </p>
          <p className="mt-1 text-[10px] text-muted-foreground">Campanha {run.createdIds.campaignId || '—'} · Conjunto {run.createdIds.adGroupId || '—'} · Anúncio {run.createdIds.adId || '—'}</p>
        </div>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">{run.status}</span>
      </div>
      {run.error && (
        <div className="mt-2 rounded-lg bg-background/70 p-2 text-[10px] leading-relaxed text-muted-foreground">
          <p className="font-semibold text-error">{run.error.userMessage}</p>
          {run.error.suggestedAction && <p className="mt-1">{run.error.suggestedAction}</p>}
        </div>
      )}
      {(run.status === 'partial' || run.status === 'failed') && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className="btn-primary !py-1.5 text-xs" onClick={() => action('resume')}><RotateCcw className="size-3.5" /> Retomar</button>
          {run.createdIds.campaignId && <button type="button" className="btn-ghost !py-1.5 text-xs text-error" onClick={() => action('cleanup')}><Trash2 className="size-3.5" /> Excluir parcial</button>}
        </div>
      )}
    </div>
  )
}

export function CatalogCampaignWizard({
  catalog,
  advertiserId,
  ready,
}: {
  catalog: AdsCatalog
  advertiserId: string
  ready: boolean
}) {
  const { data: runsData, mutate: mutateRuns } = useAdsCatalogCampaignRuns(catalog.id)
  const runs = runsData?.runs ?? []
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(catalog.name)
  const [budget, setBudget] = useState('')
  const [productScope, setProductScope] = useState<'all' | 'product_set' | 'specific'>('specific')
  const [productIds, setProductIds] = useState('')
  const [productSetId, setProductSetId] = useState('')
  const [templateId, setTemplateId] = useState('')
  const [identityId, setIdentityId] = useState('')
  const [identityType, setIdentityType] = useState('CUSTOMIZED_USER')
  const [pixelId, setPixelId] = useState('')
  const [pixelEvent, setPixelEvent] = useState('PURCHASE')
  const [text, setText] = useState('')
  const [cta, setCta] = useState('LEARN_MORE')

  const activeRun = useMemo(() => runs.find((run) => ['queued', 'running', 'retrying'].includes(run.status)), [runs])

  function payload() {
    return {
      adAccountId: advertiserId,
      name: name.trim() || catalog.name,
      budgetAmount: Number(budget), budgetType: 'daily', budgetOptimization: 'adgroup',
      country: catalog.country || 'BR', productScope,
      productIds: productIds.split(',').map((id) => id.trim()).filter(Boolean),
      productSetId: productSetId.trim() || undefined,
      catalogVideoTemplateId: templateId.trim() || undefined,
      identityId: identityId.trim() || undefined, identityType: identityId.trim() ? identityType : undefined,
      pixelId: pixelId.trim() || undefined, pixelEvent: pixelId.trim() ? pixelEvent.trim() : undefined,
      text: text.trim() || undefined, callToAction: cta,
      idempotencyKey: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${catalog.id}:${Date.now()}`,
    }
  }

  async function create() {
    if (!(Number(budget) > 0)) return toast.error('Informe um orçamento maior que zero')
    if (productScope === 'specific' && !productIds.trim()) return toast.error('Informe ao menos um Product ID do TikTok')
    if (!templateId.trim()) return toast.error('Informe o Catalog Video Template ID usado pelo anúncio')
    setBusy(true)
    try {
      const body = payload()
      await adsPreflightCatalogCampaign(catalog.id, body)
      const result = await adsCreateCatalogCampaign(catalog.id, body)
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
          <p className="mt-0.5 text-[11px] text-muted-foreground">Video Shopping Ads · Catalog video · destino obtido do produto.</p>
        </div>
        <button type="button" className="btn-primary text-xs" onClick={() => setOpen((value) => !value)} disabled={!ready || Boolean(activeRun)}>
          <Rocket className="size-3.5" /> {activeRun ? 'Criação em andamento' : 'Nova campanha'} <ChevronDown className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {!ready && <p className="mt-3 rounded-lg bg-warning/10 p-2.5 text-[10px] text-warning">Conclua o checklist de prontidão antes de criar uma campanha.</p>}

      {open && (
        <div className="mt-4 space-y-3 border-t border-border pt-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] text-muted-foreground">Nome<input className="input-base mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="text-[11px] text-muted-foreground">Orçamento diário ({catalog.currency})<input className="input-base mt-1 w-full" type="number" min="1" step="0.01" value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
          </div>
          <fieldset>
            <legend className="text-[11px] font-medium text-foreground">Produtos</legend>
            <div className="mt-1 grid gap-2 sm:grid-cols-3">
              {([['specific','Produtos específicos'],['product_set','Product set'],['all','Todos os produtos']] as const).map(([value,label]) => <label key={value} className={`cursor-pointer rounded-lg border p-2 text-xs ${productScope === value ? 'border-primary bg-primary/10 text-foreground' : 'border-border text-muted-foreground'}`}><input type="radio" className="mr-2 accent-primary" checked={productScope === value} onChange={() => setProductScope(value)} />{label}</label>)}
            </div>
          </fieldset>
          {productScope === 'specific' && <label className="block text-[11px] text-muted-foreground">Product IDs do TikTok, separados por vírgula<input className="input-base mt-1 w-full" value={productIds} onChange={(e) => setProductIds(e.target.value)} placeholder="7664730406680594184" /></label>}
          {productScope === 'product_set' && <label className="block text-[11px] text-muted-foreground">Product Set ID<input className="input-base mt-1 w-full" value={productSetId} onChange={(e) => setProductSetId(e.target.value)} /></label>}
          <label className="block text-[11px] text-muted-foreground">Catalog Video Template ID<input className="input-base mt-1 w-full" value={templateId} onChange={(e) => setTemplateId(e.target.value)} placeholder="ID do template aprovado no Catalog Manager" /></label>
          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-[11px] font-semibold text-foreground">Identidade, pixel e criativo</summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-[11px] text-muted-foreground">Identity ID<input className="input-base mt-1 w-full" value={identityId} onChange={(e) => setIdentityId(e.target.value)} placeholder="Opcional: autodetectar" /></label>
              <label className="text-[11px] text-muted-foreground">Tipo<select className="input-base mt-1 w-full" value={identityType} onChange={(e) => setIdentityType(e.target.value)}><option>CUSTOMIZED_USER</option><option>BC_AUTH_TT</option></select></label>
              <label className="text-[11px] text-muted-foreground">Pixel ID<input className="input-base mt-1 w-full" value={pixelId} onChange={(e) => setPixelId(e.target.value)} placeholder="Numérico ou alfanumérico" /></label>
              <label className="text-[11px] text-muted-foreground">Evento<input className="input-base mt-1 w-full" value={pixelEvent} onChange={(e) => setPixelEvent(e.target.value)} /></label>
              <label className="text-[11px] text-muted-foreground">Texto<input className="input-base mt-1 w-full" value={text} onChange={(e) => setText(e.target.value)} /></label>
              <label className="text-[11px] text-muted-foreground">CTA<select className="input-base mt-1 w-full" value={cta} onChange={(e) => setCta(e.target.value)}><option value="LEARN_MORE">Learn more</option><option value="SHOP_NOW">Shop now</option></select></label>
            </div>
          </details>
          <p className="rounded-lg bg-secondary/60 p-2.5 text-[10px] leading-relaxed text-muted-foreground">ABO · menor custo · TikTok placement · Product link. Não é necessário informar URL: cada clique usa o link do produto no catálogo. Tudo nasce pausado.</p>
          <div className="flex justify-end gap-2"><button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Cancelar</button><button type="button" className="btn-primary text-xs" onClick={create} disabled={busy}>{busy ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Pré-validar e criar</button></div>
        </div>
      )}

      {runs.length > 0 && <div className="mt-4 space-y-2 border-t border-border pt-4">{runs.slice(0, 5).map((run) => <RunCard key={run.id} run={run} mutate={() => { void mutateRuns() }} />)}</div>}
    </section>
  )
}
