'use client'

import { SavedVideos } from './saved-videos'
import { AdDestinationField } from './ad-destination-field'
import { MarketSelector, defaultMarket } from './market-selector'
import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'
import { useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, Loader2, UploadCloud, Video } from 'lucide-react'
import { apiSend, adsUpload, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'
import { fmtSpend } from '@/lib/format'
import {
  TIKTOK_CTA_OPTIONS,
  TIKTOK_MIN_BUDGET,
  tiktokMinimumBudgetMessage,
  tomorrowLocalIsoDate,
} from './tiktok-contracts'

export function SmartPlusCreateDialog({
  open,
  onClose,
  advertiserId,
  currency,
  onCreated,
  onConfigurePixel,
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onCreated: () => void
  onConfigurePixel?: () => void
}) {
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [endDate, setEndDate] = useState('')
  const [market, setMarket] = useState(() => defaultMarket())
  const [videoUrl, setVideoUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [body, setBody] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')
  const [uploading, setUploading] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { data: pixelState, error: pixelError, isLoading: pixelLoading } = useAdsTikTokPixels(open && Boolean(advertiserId), advertiserId)

  const tomorrow = tomorrowLocalIsoDate()
  const endDateInFuture = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= tomorrow
  const pixelReady = Boolean(pixelState?.ready && pixelState.binding)
  const pixelName = pixelState?.binding?.pixelName || pixelState?.binding?.pixelId || ''
  const videoInvalid = Boolean(videoUrl) && !/^https:\/\/\S+/.test(videoUrl.trim())
  const coverInvalid = Boolean(coverUrl) && !/^https:\/\/\S+/.test(coverUrl.trim())
  const destinationInvalid = Boolean(linkUrl) && !/^https:\/\/\S+/.test(linkUrl.trim())
  const budgetInvalid = Boolean(budget) && !(Number(budget) >= TIKTOK_MIN_BUDGET)

  const error = pixelLoading ? 'Conferindo vínculo do Pixel…'
    : pixelError ? 'Não foi possível verificar o Pixel da conta agora'
      : !pixelReady ? 'Configure o Pixel da conta antes de criar Smart+'
        : !(Number(budget) >= TIKTOK_MIN_BUDGET) ? tiktokMinimumBudgetMessage(currency, ' no total')
          : !endDateInFuture ? 'Escolha uma data de término a partir de amanhã'
            : !/^https:\/\/\S+/.test(videoUrl.trim()) ? 'Adicione um vídeo válido'
              : coverUrl.trim() && !/^https:\/\/\S+/.test(coverUrl.trim()) ? 'Use HTTPS na capa personalizada'
                : !/^https:\/\/\S+/.test(linkUrl.trim()) ? 'Informe o link HTTPS de destino'
                  : null

  const schedule = useMemo(() => {
    if (!endDateInFuture) return { days: 0, daily: 0 }
    const today = new Date()
    const end = new Date(`${endDate}T23:59:59`)
    const days = Math.max(1, Math.ceil((end.getTime() - today.getTime()) / 86400000))
    return { days, daily: Number(budget) > 0 ? Number(budget) / days : 0 }
  }, [budget, endDate, endDateInFuture])

  async function handleUpload(file: File) {
    if (!file.type.startsWith('video/')) { toast.error('Envie um arquivo de vídeo MP4 ou MOV'); return }
    if (file.size > 500 * 1024 * 1024) { toast.error('Vídeo acima de 500 MB'); return }
    setUploading(true)
    setSubmitError(null)
    try {
      const { url } = await adsUpload(file, 'video')
      setVideoUrl(url)
      if (!name.trim()) setName(file.name.replace(/\.[^.]+$/, '').slice(0, 120))
      toast.success('Vídeo enviado')
    } catch (e) {
      toast.error('Falha no upload', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setUploading(false)
    }
  }

  async function handleCoverUpload(file: File) {
    if (!file.type.startsWith('image/')) { toast.error('Envie uma imagem JPG, PNG ou WebP'); return }
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem acima de 5 MB'); return }
    setCoverUploading(true)
    setSubmitError(null)
    try {
      const { url } = await adsUpload(file, 'image')
      setCoverUrl(url)
      toast.success('Capa enviada')
    } catch (e) {
      toast.error('Falha no upload da capa', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setCoverUploading(false)
    }
  }

  async function handleSubmit() {
    if (error) return
    setSubmitting(true)
    setSubmitError(null)
    try {
      const res = await apiSend<{ dryRun?: boolean; warnings?: string[] }>('/api/ads/smart-plus', 'POST', {
        adAccountId: advertiserId,
        name: name.trim() || 'Smart+ — ' + market.countries[0],
        goal: 'conversions',
        budgetAmount: Number(budget),
        endDate,
        countries: market.countries,
        videoUrl: videoUrl.trim(),
        coverUrl: coverUrl.trim(),
        linkUrl: linkUrl.trim() || undefined,
        body: body.trim() || undefined,
        callToAction: cta,
      })
      if (res.dryRun) {
        toast.info('Simulação concluída. Nada foi criado no TikTok.')
        onClose()
        return
      }
      toast.success('Campanha Smart+ criada e pausada', { hint: 'Revise antes de ativar.' })
      onCreated()
      setName(''); setBudget(''); setEndDate(''); setMarket(defaultMarket()); setVideoUrl(''); setCoverUrl(''); setLinkUrl(''); setBody(''); setCta('SHOP_NOW')
      onClose()
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Falha inesperada ao criar Smart+'
      setSubmitError(message)
      toast.error('Falha ao criar Smart+', { hint: message })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  const field = 'launch-input'

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      busy={submitting || uploading || coverUploading}
      title="Criar campanha Smart+"
      description="O TikTok automatiza público, lance e distribuição. Você define criativo, destino, mercado, período e investimento."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className={`text-xs ${error || submitError ? 'text-warning' : 'text-success'}`}>{submitError || error || 'Revisão pronta · a Smart+ será criada pausada.'}</p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting || uploading || coverUploading}>Cancelar</button>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSubmit} disabled={Boolean(error) || submitting || uploading || coverUploading}>
              {submitting && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />} Criar Smart+ pausada
            </button>
          </div>
        </div>
      }
    >
      <div className="tiktok-create-flow">
        <section className="mb-5 border-b border-border/60 pb-4">
          <h3 className="text-sm font-semibold text-foreground">Smart+</h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">O TikTok automatiza público, lance e distribuição para conversão. O ROI-NADOS mantém sob seu controle o criativo, destino, mercado, período e investimento.</p>
        </section>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border/60 pb-4 text-xs">
          <div><span className="font-medium text-foreground">Pixel da conta</span><span className="ml-2 text-muted-foreground">{pixelLoading ? 'Conferindo…' : pixelReady ? `● Pronto · ${pixelName || 'vinculado'} · Compra` : 'Necessário para Smart+'}</span></div>
          {!pixelReady && !pixelLoading && onConfigurePixel && <button type="button" className="min-h-9 font-medium text-primary hover:underline" onClick={onConfigurePixel}>Configurar Pixel</button>}
        </div>

        <div className="launch-composer-grid">
          <fieldset disabled={submitting || uploading || coverUploading || !pixelReady} className="launch-composer-main border-0 p-0">
            <section className="launch-section-card">
              <h3 className="launch-section-title">Criativo e destino</h3>
              <p className="launch-section-copy">Escolha o vídeo e a página para onde o anúncio levará o usuário.</p>
              <div className="mt-4 space-y-4">
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Nome da campanha <span className="text-muted-foreground">(opcional)</span></span><input autoFocus className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Smart+ Verão — Conversões" maxLength={120} /></label>

                <div>
                  <span className="mb-1.5 block text-xs font-medium text-foreground">Vídeo do anúncio</span>
                  <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
                    <input className={field} value={videoUrl} onChange={e => { setVideoUrl(e.target.value); setSubmitError(null) }} placeholder="https://… (MP4) ou envie" />
                    <label className="btn-secondary min-h-10 cursor-pointer text-xs">{uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />} Enviar vídeo<input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }} /></label>
                  </div>
                  {videoInvalid && <p className="mt-1.5 text-xs text-error">Use uma URL HTTPS válida para o vídeo.</p>}
                  <div className="mt-2"><SavedVideos appearance="creation" selectedUrls={[videoUrl]} disabled={uploading || submitting} onPick={item => { setVideoUrl(item.url); if (!name.trim()) setName(item.name.replace(/\.[^.]+$/, '').slice(0, 120)) }} /></div>
                </div>

                <AdDestinationField
                  id="smart-plus-destination"
                  value={linkUrl}
                  onChange={(value) => { setLinkUrl(value); setSubmitError(null) }}
                  disabled={submitting || uploading || coverUploading}
                  label="Link de destino"
                />
                {destinationInvalid && <span className="-mt-2 block text-xs text-error">Use uma URL HTTPS válida.</span>}

                <details className="border-t border-border/60 pt-3">
                  <summary className="cursor-pointer text-xs font-medium text-foreground">Personalização <span className="font-normal text-muted-foreground">· opcional</span></summary>
                  <div className="mt-3 space-y-3">
                    <div className="launch-field-grid">
                      <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Texto do anúncio</span><input className={field} value={body} onChange={e => setBody(e.target.value)} placeholder="Chamada curta" maxLength={100} /></label>
                      <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Botão</span><select className={field} value={cta} onChange={e => setCta(e.target.value)}>{TIKTOK_CTA_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
                    </div>
                    <div>
                      <span className="mb-1.5 block text-xs font-medium text-foreground">Capa personalizada</span>
                      <div className="grid gap-2 sm:grid-cols-[1fr_auto]"><input className={field} value={coverUrl} onChange={e => setCoverUrl(e.target.value)} placeholder="https://… (JPG/PNG) ou envie" /><label className="btn-secondary min-h-10 cursor-pointer text-xs">{coverUploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />} Enviar capa<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f) }} /></label></div>
                      <p className="mt-1.5 text-xs text-muted-foreground">Sem capa personalizada, o TikTok escolhe um frame do vídeo.</p>
                      {coverInvalid && <p className="mt-1.5 text-xs text-error">Use uma URL HTTPS válida para a capa.</p>}
                    </div>
                  </div>
                </details>
              </div>
            </section>

            <section className="launch-section-card">
              <h3 className="launch-section-title">Mercado</h3>
              <p className="launch-section-copy">Escolha onde a campanha poderá entregar. Smart+ não expõe filtro manual de idioma neste fluxo.</p>
              <div className="mt-4"><MarketSelector appearance="creation" value={market} onChange={setMarket} languageAvailable={false} /></div>
            </section>

            <section className="launch-section-card">
              <h3 className="launch-section-title">Período e investimento</h3>
              <p className="launch-section-copy">Smart+ usa orçamento total e data de término. A média diária abaixo é apenas uma estimativa, não um orçamento diário configurado.</p>
              <div className="mt-4 launch-field-grid">
                <div><MoneyField label="Orçamento total" currency={currency} value={budget} onChange={value => { setBudget(value); setSubmitError(null) }} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)} no total.`} />{budgetInvalid && <p className="mt-1.5 text-xs text-error">{tiktokMinimumBudgetMessage(currency, ' no total')}</p>}</div>
                <label className="block"><span className="mb-1.5 block text-xs font-medium text-foreground">Data de término</span><input type="date" min={tomorrow} className={field} value={endDate} onChange={e => { setEndDate(e.target.value); setSubmitError(null) }} /><span className="mt-1.5 block text-xs text-muted-foreground">{schedule.days ? `${schedule.days} dia(s) estimados` : 'Escolha a data final.'}</span></label>
              </div>
            </section>
          </fieldset>

          <aside className="launch-review" aria-label="Revisão Smart+">
            <div className="launch-review-head"><div><p className="launch-review-title">Revisão</p><p className="launch-review-copy">Smart+ · será criada pausada</p></div></div>

            <div className="launch-context-line"><span>Pixel da conta</span>{pixelLoading ? <strong>Conferindo…</strong> : pixelReady ? <strong className="text-success">● Pronto · {pixelName || 'vinculado'} · Compra</strong> : <strong className="text-warning">Necessário</strong>}</div>
            {!pixelReady && !pixelLoading && <div className="launch-inline-warning"><span>Smart+ de conversão usa o Pixel central da conta.</span>{onConfigurePixel && <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onConfigurePixel}>Configurar Pixel</button>}</div>}

            {coverUrl ? <div className="launch-preview-card"><div className="launch-preview-media"><img src={coverUrl} alt="Prévia da capa do anúncio" /></div><div className="launch-preview-body"><strong>{name.trim() || 'Smart+'}</strong><p>{body.trim() || 'Criativo pronto para otimização do TikTok.'}</p></div></div> : <div className="launch-preview-card"><div className="launch-preview-media"><Video className="size-7 text-muted-foreground" /></div><div className="launch-preview-body"><strong>{videoUrl ? 'Vídeo selecionado' : 'Aguardando criativo'}</strong><p>{body.trim() || 'A prévia final depende do vídeo e da otimização Smart+.'}</p></div></div>}

            <div className="launch-review-list">
              <div className="launch-review-row"><span>Formato</span><strong>Smart+</strong></div>
              <div className="launch-review-row"><span>Objetivo</span><strong>Conversões</strong></div>
              <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
              <div className="launch-review-row"><span>Período</span><strong>{schedule.days ? `${schedule.days} dia(s)` : '—'}</strong></div>
              <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
              <div className="launch-review-row"><span>Automação</span><strong>TikTok Smart+</strong></div>
            </div>

            <div className="launch-review-total"><span className="text-xs text-muted-foreground">Investimento total</span><strong>{Number(budget) > 0 ? fmtSpend(Number(budget), currency) : '—'}</strong><p className="mt-1 text-xs text-muted-foreground">{schedule.daily > 0 ? `Média aproximada de ${fmtSpend(schedule.daily, currency)}/dia · não é orçamento diário configurado` : 'A média diária aparece após definir o período.'}</p></div>

            {submitError ? <div className="launch-review-error"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{submitError}</span></div> : error ? <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-4 shrink-0" /><span>{error}</span></div> : <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span>Pronta para criar pausada. A automação de entrega é do TikTok Smart+.</span></div>}
          </aside>
        </div>
      </div>
    </Modal>
  )
}
