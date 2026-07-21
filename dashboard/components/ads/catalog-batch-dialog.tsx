'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Loader2, PackageOpen, Rocket, UploadCloud } from 'lucide-react'
import { adsCreateCatalogBatch, adsPreviewCatalogBatch, useAdsTikTokPixels } from '@/lib/api'
import { buildCatalogBatchPlan } from '@/lib/catalog-batch-plan'
import { catalogPixelLabel, catalogPixelValue, pickDefaultCatalogPixel } from '@/lib/catalog-pixels'
import { TIKTOK_PIXEL_EVENTS } from './tiktok-contracts'
import type { AdsCatalogBatchPreviewResponse } from '@/lib/types'
import { toast } from '@/lib/toast'

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function CatalogBatchDialog({
  advertiserId,
  onCreated,
}: {
  advertiserId: string
  onCreated: () => void
}) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const [syncToTikTok, setSyncToTikTok] = useState(true)
  const [scheduleCampaigns, setScheduleCampaigns] = useState(false)
  const [preview, setPreview] = useState<AdsCatalogBatchPreviewResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const [defaultPixelId, setDefaultPixelId] = useState('')
  const [defaultPixelEvent, setDefaultPixelEvent] = useState('ON_WEB_ORDER')
  const idempotencyKeyRef = useRef<string | null>(null)

  // Pixels da conta: carregados automaticamente quando o gestor decide preparar
  // campanhas, para que o Pixel venha selecionado sem digitação manual.
  const { data: pixelsData, error: pixelsError, isLoading: pixelsLoading } = useAdsTikTokPixels(open && scheduleCampaigns, advertiserId)
  const availablePixels = useMemo(() => (pixelsData?.pixels ?? [])
    .map((pixel) => ({ pixel, value: catalogPixelValue(pixel) }))
    .filter((option) => option.value), [pixelsData?.pixels])

  useEffect(() => {
    if (!scheduleCampaigns || defaultPixelId || !availablePixels.length) return
    const best = pickDefaultCatalogPixel(pixelsData?.pixels ?? [])
    if (best) {
      setDefaultPixelId(best)
      idempotencyKeyRef.current = null
      setPreview(null)
    }
  }, [scheduleCampaigns, defaultPixelId, availablePixels.length, pixelsData?.pixels])

  // Converte códigos do Events Manager (colados no campo padrão ou na coluna
  // pixel_id) para o ID numérico usando a lista autenticada da conta.
  const pixelCodeMap = useMemo(() => {
    const map: Record<string, string> = {}
    for (const { pixel, value } of availablePixels) {
      const code = String(pixel.code || '').trim().toUpperCase()
      if (code && !/^\d+$/.test(code)) map[code] = value
    }
    return map
  }, [availablePixels])

  const plan = useMemo(
    () => buildCatalogBatchPlan(source, currency, {
      requireCampaignPixel: scheduleCampaigns,
      defaultPixelId: scheduleCampaigns ? defaultPixelId : '',
      defaultPixelEvent,
      pixelCodeMap,
    }),
    [source, currency, scheduleCampaigns, defaultPixelId, defaultPixelEvent, pixelCodeMap],
  )
  const campaignCount = plan.catalogs.reduce((total, catalog) => total + catalog.campaigns.length, 0)
  const canSubmit = plan.catalogs.length > 0 && !plan.message && !busy
  const campaignRequiresSync = scheduleCampaigns && !syncToTikTok
  const syncNotReady = Boolean(preview?.ok && syncToTikTok && !preview.automation.catalogSync)
  const creationBlocked = campaignRequiresSync || syncNotReady

  function dirty(next?: string) {
    if (next !== undefined) setSource(next)
    idempotencyKeyRef.current = null
    setPreview(null)
  }

  function invalidatePlan() {
    idempotencyKeyRef.current = null
    setPreview(null)
  }

  async function validate() {
    if (!plan.catalogs.length) return toast.error(plan.message || 'Cole as linhas do lote primeiro')
    setBusy('preview')
    try {
      const response = await adsPreviewCatalogBatch(advertiserId, {
        plan: { catalogs: plan.catalogs }, syncToTikTok, scheduleCampaigns,
      })
      setPreview(response)
      const hasExecutionPrerequisite = campaignRequiresSync || (syncToTikTok && !response.automation.catalogSync)
      if (response.ok && hasExecutionPrerequisite) {
        toast.info('Lote válido, mas falta um pré-requisito', {
          hint: campaignRequiresSync
            ? 'Campanhas Product Link exigem que a sincronização com o TikTok esteja ligada.'
            : 'Confira o Business Center, a origem pública e as permissões do conector antes de criar.',
        })
      } else if (response.ok) toast.success('Lote validado', { hint: `${response.preview.summary.normalizedProducts} produto(s) prontos para criar.` })
      else toast.error('Há itens para corrigir no lote')
    } catch (error) {
      toast.error('Não foi possível validar o lote', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  async function create() {
    if (!preview?.ok) return void validate()
    if (campaignRequiresSync) {
      toast.info('Ative a sincronização com o TikTok para preparar campanhas Product Link.')
      return
    }
    if (syncNotReady) {
      toast.info('A sincronização ainda não está pronta', {
        hint: 'Confira o Business Center, a origem pública e as permissões do conector.',
      })
      return
    }
    setBusy('create')
    try {
      const result = await adsCreateCatalogBatch(advertiserId, {
        plan: { catalogs: plan.catalogs }, syncToTikTok, scheduleCampaigns,
        idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = randomKey()),
      })
      if (result.dryRun) {
        toast.info('Modo simulação: lote validado sem criar recursos no TikTok')
        return
      }
      const summary = result.execution?.summary
      if (!summary) throw new Error('O servidor não devolveu o resumo da execução do lote.')
      const details: string[] = []
      if (summary.sync.queued > 0) details.push(`${summary.sync.queued} sincronização(ões) na fila`)
      if (scheduleCampaigns && summary.campaigns.queued > 0) {
        details.push(result.automation.productLinkCampaign
          ? `${summary.campaigns.queued} campanha(s) preparada(s), aguardando a aprovação do catálogo`
          : `${summary.campaigns.queued} campanha(s) preparada(s), aguardando Product Link do conector`)
      }
      if (scheduleCampaigns && summary.campaigns.skipped > 0) details.push(`${summary.campaigns.skipped} campanha(s) ignorada(s)`)
      const failures = summary.catalogs.failed + summary.products.failed + summary.sync.failed + summary.campaigns.failed
      if (failures > 0) {
        details.push(`${failures} falha(s): ${summary.catalogs.failed} catálogo(s), ${summary.products.failed} produto(s), ${summary.sync.failed} sincronização(ões), ${summary.campaigns.failed} campanha(s)`)
        toast.error('Lote concluído com pendências', { hint: details.join(' · ') })
      } else {
        const campaigns = scheduleCampaigns && summary.campaigns.total > 0 ? ` e ${summary.campaigns.queued} campanha(s) preparada(s)` : ''
        toast.success(`${summary.catalogs.completed} catálogo(s) criado(s)${campaigns}`, {
          hint: details.length ? details.join(' · ') : undefined,
        })
      }
      setOpen(false)
      setSource('')
      idempotencyKeyRef.current = null
      setPreview(null)
      onCreated()
    } catch (error) {
      toast.error('O lote não foi concluído', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="relative w-full sm:w-auto">
      <button type="button" className="btn-ghost shrink-0 self-start text-xs sm:self-auto" onClick={() => setOpen((value) => !value)}>
        <UploadCloud className="size-3.5" aria-hidden="true" /> Lote rápido
      </button>
      {open && (
        <section className="mt-3 w-full rounded-xl border border-primary/30 bg-background p-4 text-left shadow-xl sm:absolute sm:right-0 sm:z-20 sm:mt-2 sm:w-[min(760px,calc(100vw-2rem))]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">Lote rápido de catálogos</h3>
              <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-muted-foreground">
                O <strong className="text-foreground">Link do produto</strong> é o único destino usado; não existe campo de URL no nível do anúncio.
              </p>
            </div>
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)}>Fechar</button>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <label className="text-[11px] text-muted-foreground">
              Cole TSV do Excel/Sheets ou CSV (vírgula ou ponto e vírgula)
              <textarea
                className="input-base mt-1 min-h-44 w-full resize-y font-mono text-[11px]"
                value={source}
                onChange={(event) => dirty(event.target.value)}
                placeholder={'catalogo\tsku\ttitulo\tpreco\tmarca\tlink\timagem\tcampanha\torcamento\tpixel_id\tvideo\tcapa\nLoja Verão\tSKU-001\tCamiseta\t79,90\tMinha Marca\thttps://loja.com/camiseta\thttps://cdn.com/camiseta.jpg\tVerão — todos\t50\t1234567890123456789\tv10033g50000abc\ttos-alisg-p/capa'}
              />
              {source.trim() && plan.message && (
                <span className="mt-1 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning" role="alert">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> {plan.message}
                </span>
              )}
            </label>
            <div className="flex gap-3 sm:flex-col">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">Moeda
                <select className="input-base" value={currency} onChange={(event) => { setCurrency(event.target.value); invalidatePlan() }}>
                  <option>BRL</option><option>USD</option><option>EUR</option><option>MXN</option>
                </select>
              </label>
              <div className="rounded-lg bg-secondary/50 p-2 text-[10px] text-muted-foreground">
                <strong className="block text-foreground">{plan.catalogs.length} catálogo(s)</strong>
                {plan.rows} linha(s) · {plan.catalogs.reduce((total, catalog) => total + catalog.products.length, 0)} produto(s)
              </div>
            </div>
          </div>

          <div className="mt-3 grid gap-2 rounded-lg border border-border bg-secondary/20 p-3 text-[11px]">
            <label className="flex items-start gap-2 text-muted-foreground">
              <input className="mt-0.5 accent-primary" type="checkbox" checked={syncToTikTok} onChange={(event) => { setSyncToTikTok(event.target.checked); invalidatePlan() }} />
              <span><strong className="text-foreground">Sincronizar automaticamente com o TikTok</strong><br />{preview?.automation.catalogCreationNote || 'Publica o feed e cria o job durável de catálogo. Tudo fica sem veiculação até revisão.'}</span>
            </label>
            <label className="flex items-start gap-2 text-muted-foreground">
              <input className="mt-0.5 accent-primary" type="checkbox" checked={scheduleCampaigns} onChange={(event) => { setScheduleCampaigns(event.target.checked); invalidatePlan() }} />
              <span><strong className="text-foreground">Preparar campanhas Product Link pausadas</strong><br />{preview?.automation.productLinkNote || 'Valide o lote para consultar o conector Product Link.'}</span>
            </label>
            {scheduleCampaigns && <p className="rounded-md bg-background/70 px-2 py-1.5 text-[10px] text-muted-foreground">Cada campanha vira um <strong className="text-foreground">Video Shopping Ads de catálogo</strong>, pausado. Colunas por campanha: <strong className="text-foreground">pixel_id</strong> (6–30 dígitos), <strong className="text-foreground">video</strong> (o video_id do seu criativo) e <strong className="text-foreground">capa</strong> (image_id da capa). O destino é o <strong className="text-foreground">Product Link</strong> — cada produto usa o próprio <strong className="text-foreground">link</strong> do catálogo; você nunca digita URL no anúncio.</p>}
            {scheduleCampaigns && (
              <div className="grid gap-2 rounded-md bg-background/70 p-2 sm:grid-cols-2">
                <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                  <span><strong className="text-foreground">Pixel padrão do lote</strong> (aplicado a linhas sem pixel_id)</span>
                  {availablePixels.length > 0 ? (
                    <select
                      className="input-base text-[11px]"
                      value={defaultPixelId}
                      onChange={(event) => { setDefaultPixelId(event.target.value); invalidatePlan() }}
                    >
                      <option value="">Sem Pixel padrão — usar somente a coluna pixel_id</option>
                      {defaultPixelId && !availablePixels.some((option) => option.value === defaultPixelId) && (
                        <option value={defaultPixelId}>Pixel informado manualmente · ID {defaultPixelId}</option>
                      )}
                      {availablePixels.map(({ pixel, value }) => (
                        <option key={`${pixel.id}:${value}`} value={value}>{catalogPixelLabel(pixel)}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input-base text-[11px]"
                      maxLength={30}
                      value={defaultPixelId}
                      onChange={(event) => { setDefaultPixelId(event.target.value.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 30)); invalidatePlan() }}
                      placeholder={pixelsLoading ? 'Carregando Pixels da conta…' : pixelsError ? 'Lista indisponível — cole o ID numérico do Pixel' : 'ID numérico ou código (ex.: D9F2J3JC77U5KEVKQB80)'}
                    />
                  )}
                </label>
                <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                  <span><strong className="text-foreground">Evento padrão</strong> (linhas sem a coluna evento)</span>
                  <select
                    className="input-base text-[11px]"
                    value={defaultPixelEvent}
                    onChange={(event) => { setDefaultPixelEvent(event.target.value); invalidatePlan() }}
                  >
                    {TIKTOK_PIXEL_EVENTS.map((event) => <option key={event.value} value={event.value}>{event.label}</option>)}
                  </select>
                </label>
                <p className="text-[10px] leading-relaxed text-muted-foreground sm:col-span-2">
                  {availablePixels.length > 0
                    ? 'O Pixel com mais compras em 30 dias já vem selecionado. As colunas pixel_id e evento continuam valendo como exceção por linha.'
                    : pixelsLoading
                      ? 'Buscando os Pixels da conta de anúncio…'
                      : 'A lista de Pixels da conta não pôde ser carregada; cole o ID numérico (6 a 30 dígitos) do Pixel ou use a coluna pixel_id.'}
                  {' '}Nenhuma URL ou template é obrigatório no nível do anúncio.
                </p>
              </div>
            )}
            {campaignRequiresSync && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
                Para preparar campanhas, mantenha “Sincronizar automaticamente com o TikTok” ligado.
              </p>
            )}
            {scheduleCampaigns && campaignCount === 0 && (
              <p className="rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
                Nenhuma campanha foi encontrada. Preencha as colunas “campanha” e “orçamento” antes de criar o lote.
              </p>
            )}
          </div>

          {preview && (
            <div className={`mt-3 rounded-lg border p-3 text-[11px] ${preview.ok ? 'border-success/30 bg-success/5' : 'border-error/30 bg-error/5'}`}>
              <p className="flex items-center gap-1.5 font-semibold text-foreground">
                {preview.ok ? <Check className="size-3.5 text-success" /> : <AlertCircle className="size-3.5 text-error" />}
                {preview.preview.summary.normalizedCatalogs} catálogo(s) · {preview.preview.summary.normalizedProducts} produto(s) · {preview.preview.summary.normalizedCampaigns} campanha(s) no plano
              </p>
              {!preview.ok && <ul className="mt-2 space-y-1 text-error">
                {[...preview.preview.errors, ...(preview.campaignSpecErrors || [])].slice(0, 5).map((error, index) => <li key={`${error.code}-${index}`}>• {error.path || 'Lote'}: {error.message}</li>)}
              </ul>}
              {preview.tooLarge && <p className="mt-2 text-error">{preview.tooLarge.problems.join(' · ')}</p>}
              {preview.ok && !preview.automation.catalogSync && syncToTikTok && (
                <p className="mt-2 text-warning">
                  A sincronização ainda não está pronta. Confira o Business Center, a origem pública e as permissões do conector.
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={Boolean(busy)}>Cancelar</button>
            <button type="button" className="btn-ghost text-xs" onClick={validate} disabled={!canSubmit}>
              {busy === 'preview' ? <Loader2 className="size-3.5 animate-spin" /> : <PackageOpen className="size-3.5" />} Validar lote
            </button>
            <button
              type="button"
              className="btn-primary text-xs"
              onClick={create}
              disabled={!canSubmit || !preview?.ok || creationBlocked || (scheduleCampaigns && campaignCount === 0)}
              title={campaignRequiresSync
                ? 'Campanhas Product Link exigem sincronização com o TikTok.'
                : syncNotReady
                  ? 'Confira Business Center, origem pública e permissões do conector.'
                  : scheduleCampaigns && campaignCount === 0
                    ? 'Adicione ao menos uma campanha ao lote.'
                    : undefined}
            >
              {busy === 'create' ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Criar lote
            </button>
          </div>
          {campaignCount > 0 && <p className="mt-2 text-[10px] text-muted-foreground">As campanhas do lote usam todos os produtos do catálogo e sempre nascem pausadas.</p>}
        </section>
      )}
    </div>
  )
}
