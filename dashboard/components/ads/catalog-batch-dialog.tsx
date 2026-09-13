'use client'

import { Modal } from '@/components/ui/modal'
import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, Download, FileUp, Loader2, PackageOpen, Rocket, Upload, UploadCloud, Video } from 'lucide-react'
import { adsCreateCatalogBatch, adsPreviewCatalogBatch, adsUpload } from '@/lib/api'
import { buildCatalogBatchPlan } from '@/lib/catalog-batch-plan'
import type { AdsCatalogBatchPreviewResponse } from '@/lib/types'
import { toast } from '@/lib/toast'

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const CATALOG_BATCH_TEMPLATE = [
  ['catalogo', 'sku', 'titulo', 'descricao', 'preco', 'marca', 'link', 'imagem', 'campanha', 'orcamento', 'tipo_orcamento', 'pais', 'periodo'],
  ['Loja Verão', 'SKU-001', 'Camiseta azul', 'Camiseta de algodão azul', '79,90', 'Minha Marca', 'https://loja.exemplo.com/camiseta-azul', 'https://cdn.exemplo.com/camiseta-azul.jpg', 'Verão — todos', '50', 'daily', 'BR', ''],
  ['Loja Verão', 'SKU-002', 'Camiseta preta', 'Camiseta de algodão preta', '79,90', 'Minha Marca', 'https://loja.exemplo.com/camiseta-preta', 'https://cdn.exemplo.com/camiseta-preta.jpg', 'Verão — todos', '50', 'daily', 'BR', ''],
  ['Loja Verão', 'SKU-003', 'Camiseta branca', 'Camiseta de algodão branca', '79,90', 'Minha Marca', 'https://loja.exemplo.com/camiseta-branca', 'https://cdn.exemplo.com/camiseta-branca.jpg', 'Verão — todos', '50', 'daily', 'BR', ''],
  ['Loja Verão', 'SKU-004', 'Camiseta verde', 'Camiseta de algodão verde', '79,90', 'Minha Marca', 'https://loja.exemplo.com/camiseta-verde', 'https://cdn.exemplo.com/camiseta-verde.jpg', 'Verão — todos', '50', 'daily', 'BR', ''],
].map((row) => row.join('\t')).join('\n')

function campaignSummary(campaign: Record<string, unknown>, currency: string) {
  const amount = typeof campaign.budgetAmount === 'number' ? campaign.budgetAmount : Number(campaign.budgetAmount)
  const budget = Number.isFinite(amount)
    ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(amount)
    : 'Orçamento não informado'
  return {
    name: String(campaign.name || 'Campanha sem nome'),
    budget: `${budget} ${campaign.budgetType === 'lifetime' ? 'total' : 'por dia'}`,
  }
}

export function CatalogBatchDialog({
  openRequest = 0,
  advertiserId,
  advertiserCurrency,
  onCreated,
  showTrigger = true,
}: {
  openRequest?: number
  advertiserId: string
  advertiserCurrency: string
  onCreated: () => void
  showTrigger?: boolean
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (openRequest > 0) setOpen(true)
  }, [openRequest])
  const [source, setSource] = useState('')
  const [currency, setCurrency] = useState('BRL')
  const [syncToTikTok, setSyncToTikTok] = useState(true)
  const [scheduleCampaigns, setScheduleCampaigns] = useState(false)
  const [videoUrl, setVideoUrl] = useState('')
  const [videoName, setVideoName] = useState('')
  const [uploadingVideo, setUploadingVideo] = useState(false)
  const [preview, setPreview] = useState<AdsCatalogBatchPreviewResponse | null>(null)
  const [busy, setBusy] = useState<'preview' | 'create' | null>(null)
  const idempotencyKeyRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const plan = useMemo(
    () => buildCatalogBatchPlan(source, currency),
    [source, currency],
  )
  const executionPlan = useMemo(() => ({
    catalogs: plan.catalogs.map((catalog) => ({
      ...catalog,
      campaigns: catalog.campaigns.map((campaign) => ({
        ...campaign,
        ...(videoUrl ? { videoUrl } : {}),
      })),
    })),
  }), [plan.catalogs, videoUrl])
  const campaignCount = plan.catalogs.reduce((total, catalog) => total + catalog.campaigns.length, 0)
  const canSubmit = plan.catalogs.length > 0 && !plan.message && (!scheduleCampaigns || Boolean(videoUrl)) && !busy
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

  async function importFile(file: File) {
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      toast.error('Formato não aceito', { hint: 'Escolha um arquivo .csv, .tsv ou .txt.' })
      return
    }
    if (file.size > 25 * 1024 * 1024) {
      toast.error('Arquivo maior que 25 MB', { hint: 'Divida o lote em arquivos menores antes de importar.' })
      return
    }
    try {
      const text = (await file.text()).replace(/^\uFEFF/, '')
      if (!text.trim()) throw new Error('O arquivo está vazio.')
      dirty(text)
      toast.success('Arquivo importado', { hint: `${file.name} está pronto para validação.` })
    } catch (error) {
      toast.error('Não foi possível ler o arquivo', { hint: error instanceof Error ? error.message : undefined })
    }
  }

  async function uploadCampaignVideo(file: File) {
    if (!/\.(mp4|mov)$/i.test(file.name)) return toast.error('Envie um vídeo MP4 ou MOV')
    setUploadingVideo(true)
    try {
      const result = await adsUpload(file, 'video')
      setVideoUrl(result.url)
      setVideoName(file.name)
      invalidatePlan()
      toast.success('Vídeo pronto para as campanhas')
    } catch (error) {
      toast.error('Não foi possível enviar o vídeo', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setUploadingVideo(false)
    }
  }

  function downloadTemplate() {
    const blob = new Blob([CATALOG_BATCH_TEMPLATE], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'modelo-catalogos-em-massa.tsv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function validate() {
    if (!plan.catalogs.length) return toast.error(plan.message || 'Cole as linhas do lote primeiro')
    if (scheduleCampaigns && !videoUrl) return toast.error('Envie o vídeo que será usado nas campanhas')
    setBusy('preview')
    try {
      const response = await adsPreviewCatalogBatch(advertiserId, {
        plan: executionPlan, syncToTikTok, scheduleCampaigns,
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
        plan: executionPlan, syncToTikTok, scheduleCampaigns,
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
      {showTrigger && <button type="button" className="btn-ghost shrink-0 self-start text-xs sm:self-auto" onClick={() => setOpen((value) => !value)}>
        <UploadCloud className="size-3.5" aria-hidden="true" /> Catálogos em massa
      </button>}
      <Modal isOpen={open} busy={Boolean(busy || uploadingVideo)} onClose={() => setOpen(false)} title="Importar planilha" description="Organize os produtos e revise o lote antes de criar." maxWidth="max-w-3xl">
        <div className="ads-dialog">
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]">
            <div className="text-[11px] text-muted-foreground">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label htmlFor="catalog-batch-source">Cole as linhas da planilha ou importe um arquivo CSV/TSV</label>
                <div className="flex flex-wrap gap-1.5">
                  <input
                    ref={fileInputRef}
                    className="sr-only"
                    type="file"
                    accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) void importFile(file)
                      event.target.value = ''
                    }}
                  />
                  <button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={() => fileInputRef.current?.click()}>
                    <FileUp className="size-3" aria-hidden="true" /> Importar arquivo
                  </button>
                  <button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={downloadTemplate}>
                    <Download className="size-3" aria-hidden="true" /> Baixar modelo TSV
                  </button>
                </div>
              </div>
              <textarea
                id="catalog-batch-source"
                className="input-base mt-1 min-h-44 w-full resize-y font-mono text-[11px]"
                value={source}
                onChange={(event) => dirty(event.target.value)}
                placeholder={'catalogo\tsku\ttitulo\tpreco\tmarca\tlink\timagem\tcampanha\torcamento\nLoja Verão\tSKU-001\tCamiseta\t79,90\tMinha Marca\thttps://loja.com/camiseta\thttps://cdn.com/camiseta.jpg\tVerão — todos\t50'}
              />
              {source.trim() && plan.message && (
                <span className="mt-1 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning" role="alert">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" aria-hidden="true" /> {plan.message}
                </span>
              )}
            </div>
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
              <span><strong className="text-foreground">Sincronizar automaticamente com o TikTok</strong><br />{preview?.automation.catalogCreationNote || 'Envia os produtos e acompanha o processamento. As campanhas continuam pausadas.'}</span>
            </label>
            <label className="flex items-start gap-2 text-muted-foreground">
              <input className="mt-0.5 accent-primary" type="checkbox" checked={scheduleCampaigns} onChange={(event) => { setScheduleCampaigns(event.target.checked); invalidatePlan() }} />
              <span><strong className="text-foreground">Preparar campanhas Product Link pausadas</strong><br />{preview?.automation.productLinkNote || 'Valide o lote para consultar o conector Product Link.'}</span>
            </label>
            {scheduleCampaigns && (
              <label className="rounded-lg border border-border bg-background/70 p-3">
                <span className="flex items-center gap-2 font-medium text-foreground"><Video className="size-4 text-primary" /> Vídeo das campanhas</span>
                <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">Um MP4/MOV com áudio para todas as campanhas do arquivo. Pixel da conta TikTok · otimização para Compra · capa gerada do vídeo.</span>
                <span className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="btn-ghost cursor-pointer px-2 py-1 text-[10px]">
                    {uploadingVideo ? <Loader2 className="size-3 animate-spin" /> : <Upload className="size-3" />}
                    {videoUrl ? 'Trocar vídeo' : 'Enviar vídeo'}
                    <input
                      className="sr-only"
                      type="file"
                      accept="video/mp4,video/quicktime,.mp4,.mov"
                      disabled={uploadingVideo}
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadCampaignVideo(file)
                        event.currentTarget.value = ''
                      }}
                    />
                  </span>
                  {videoName && <span className="max-w-full truncate text-[10px] text-success"><Check className="mr-1 inline size-3" />{videoName}</span>}
                </span>
              </label>
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
              {preview.ok && scheduleCampaigns && (
                <p className={`mt-2 rounded-md border px-2 py-1.5 leading-relaxed ${preview.automation.productLinkCampaign ? 'border-success/20 bg-success/5 text-muted-foreground' : 'border-warning/30 bg-warning/10 text-warning'}`}>
                  {preview.automation.productLinkCampaign
                    ? 'Product Link e o formato foram confirmados. Depois da aprovação, o TikTok montará o anúncio com os produtos e seus próprios links; nenhuma URL manual será enviada.'
                    : 'Product Link ainda não foi confirmado pelo conector. As campanhas ficarão preparadas, mas nenhum criativo de catálogo será enviado ao TikTok até essa confirmação.'}
                </p>
              )}
              {preview.ok && (
                <div className="mt-3 rounded-md border border-border/70 bg-background/60 p-2.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Resumo por catálogo</p>
                  <div className="mt-2 max-h-56 space-y-2 overflow-y-auto pr-1">
                    {plan.catalogs.map((catalog) => (
                      <div key={catalog.key} className="rounded-md bg-secondary/40 p-2">
                        <div className="flex flex-wrap items-baseline justify-between gap-1">
                          <strong className="text-foreground">{catalog.name}</strong>
                          <span className="text-[10px] text-muted-foreground">{catalog.products.length} produto(s) · {catalog.campaigns.length} campanha(s)</span>
                        </div>
                        {catalog.campaigns.length > 0 ? (
                          <ul className="mt-1.5 space-y-1">
                            {catalog.campaigns.map((campaign, index) => {
                              const summary = campaignSummary(campaign, advertiserCurrency)
                              return (
                                <li key={`${summary.name}-${index}`} className="grid gap-0.5 border-t border-border/50 pt-1.5 first:border-0 first:pt-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-3">
                                  <span className="truncate font-medium text-foreground">{summary.name}</span>
                                  <span className="text-muted-foreground sm:text-right">{summary.budget}</span>
                                  <span className="truncate text-[10px] text-muted-foreground sm:col-span-2">Pixel da conta TikTok</span>
                                </li>
                              )
                            })}
                          </ul>
                        ) : <p className="mt-1 text-[10px] text-muted-foreground">Somente catálogo e produtos; nenhuma campanha foi solicitada.</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setOpen(false)} disabled={Boolean(busy) || uploadingVideo}>Cancelar</button>
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
              {busy === 'create' ? <Loader2 className="size-3.5 animate-spin" /> : <Rocket className="size-3.5" />} Criar em massa
            </button>
          </div>
          {campaignCount > 0 && <p className="mt-2 text-[10px] text-muted-foreground">As campanhas do lote usam todos os produtos do catálogo e sempre nascem pausadas.</p>}
        </div>
      </Modal>
    </div>
  )
}
