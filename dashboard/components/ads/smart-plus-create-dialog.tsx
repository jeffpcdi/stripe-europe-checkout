'use client'

import { SavedVideos } from './saved-videos'
import { MarketSelector, defaultMarket } from './market-selector'

import { Modal } from '@/components/ui/modal'
import { MoneyField } from '@/components/ui/money-field'

// Criação de campanha Smart+ — formulário único e enxuto (não um wizard). O
// TikTok automatiza targeting/lance/criativo, então o gestor só informa o
// essencial: objetivo, orçamento total + término, vídeo e destino. Tudo nasce
// PAUSADO; a criação é composta no backend (campanha → grupo → vídeo → anúncio).

import { useMemo, useState } from 'react'
import { Loader2, UploadCloud, Check, Sparkles, CalendarDays, Target, Video, AlertCircle, CheckCircle2 } from 'lucide-react'
import { apiSend, adsUpload } from '@/lib/api'
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
}: {
  open: boolean
  onClose: () => void
  advertiserId: string
  currency: string
  onCreated: () => void
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

  if (!open) return null

  const tomorrow = tomorrowLocalIsoDate()
  const endDateInFuture = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= tomorrow

  const error =
    !(Number(budget) >= TIKTOK_MIN_BUDGET) ? tiktokMinimumBudgetMessage(currency, ' no total')
        : !endDateInFuture ? 'Escolha uma data de término a partir de amanhã'
          : !/^https:\/\/\S+/.test(videoUrl.trim()) ? 'Adicione o vídeo (URL https ou upload)'
            : coverUrl.trim() && !/^https:\/\/\S+/.test(coverUrl.trim()) ? 'Use HTTPS na capa personalizada'
              : !/^https:\/\/\S+/.test(linkUrl.trim()) ? 'Informe o link de destino'
                : null

  const schedule = useMemo(() => {
    if (!endDateInFuture) return { days: 0, daily: 0 }
    const today = new Date()
    const end = new Date(`${endDate}T23:59:59`)
    const days = Math.max(1, Math.ceil((end.getTime() - today.getTime()) / 86400000))
    return { days, daily: Number(budget) > 0 ? Number(budget) / days : 0 }
  }, [budget, endDate, endDateInFuture])


  async function handleUpload(file: File) {
    if (!file.type.startsWith('video/')) { toast.error('Envie um arquivo de vídeo (MP4)'); return }
    if (file.size > 500 * 1024 * 1024) { toast.error('Vídeo acima de 500 MB'); return }
    setUploading(true)
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
      if (res.dryRun) toast.info('Modo simulação: nada foi criado no TikTok')
      else toast.success('Campanha Smart+ criada (pausada)', { hint: 'Revise e ative em Campanhas.' })
      onCreated()
      setName(''); setBudget(''); setEndDate(''); setMarket(defaultMarket()); setVideoUrl(''); setCoverUrl(''); setLinkUrl(''); setBody(''); setCta('SHOP_NOW')
      onClose()
    } catch (e) {
      toast.error('Falha ao criar Smart+', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  const field = 'input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      busy={submitting || uploading || coverUploading}
      title="Criar campanha Smart+"
      description="Defina o essencial e deixe o TikTok automatizar público, lance e entrega."
      maxWidth="max-w-5xl"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-3">
          <p className={`text-[11px] ${error ? 'text-warning' : 'text-success'}`}>
            {error || 'Revisão pronta · a campanha será criada pausada.'}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting || uploading || coverUploading}>Cancelar</button>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSubmit} disabled={Boolean(error) || submitting || uploading || coverUploading}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Criar Smart+ pausada
            </button>
          </div>
        </div>
      }
    >
      <div className="mb-4 launch-kind-grid">
        <div className="launch-kind-card" data-active="true">
          <Sparkles className="size-4 shrink-0" />
          <span><strong>Smart+ automatizada</strong><small>O TikTok decide a distribuição e otimiza para conversão.</small></span>
        </div>
        <div className="launch-kind-card" data-active="false">
          <Target className="size-4 shrink-0" />
          <span><strong>Objetivo</strong><small>Conversões usando o pixel configurado na conta.</small></span>
        </div>
        <div className="launch-kind-card" data-active="false">
          <CheckCircle2 className="size-4 shrink-0" />
          <span><strong>Publicação segura</strong><small>Nasce pausada para revisão antes de veicular.</small></span>
        </div>
      </div>

      <div className="launch-composer-grid">
        <fieldset disabled={submitting || uploading || coverUploading} className="launch-composer-main border-0 p-0">
          <section className="launch-section-card">
            <span className="launch-section-kicker">1 · Criativo e destino</span>
            <h3 className="launch-section-title">O anúncio que o Smart+ vai distribuir</h3>
            <p className="launch-section-copy">Escolha um vídeo, informe a página de destino e, se quiser, personalize o texto e o botão.</p>

            <div className="mt-4 space-y-4">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Nome da campanha <span className="text-muted-foreground">(opcional)</span></span>
                <input autoFocus className={field} value={name} onChange={e => setName(e.target.value)} placeholder="Ex.: Smart+ Verão — Conversões" maxLength={120} />
              </label>

              <div className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Vídeo do anúncio</span>
                <div className="flex gap-2">
                  <input className={field} value={videoUrl} onChange={e => setVideoUrl(e.target.value)} placeholder="https://… (MP4) ou envie" />
                  <label className="btn-secondary shrink-0 cursor-pointer text-xs">
                    {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
                    Enviar
                    <input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }} />
                  </label>
                </div>
                <SavedVideos selectedUrls={[videoUrl]} disabled={uploading || submitting} onPick={item => { setVideoUrl(item.url); if (!name.trim()) setName(item.name.replace(/\.[^.]+$/, '').slice(0, 120)) }} />
              </div>

              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Link de destino</span>
                <input className={field} value={linkUrl} onChange={e => setLinkUrl(e.target.value)} placeholder="https://seusite.com/oferta" />
              </label>

              <div className="launch-field-grid">
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">Texto do anúncio</span>
                  <input className={field} value={body} onChange={e => setBody(e.target.value)} placeholder="Chamada curta" maxLength={100} />
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-medium text-foreground">Botão</span>
                  <select className={field} value={cta} onChange={e => setCta(e.target.value)}>
                    {TIKTOK_CTA_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>

              <details className="rounded-xl border border-border/50 bg-secondary/10 px-3 py-2 text-xs">
                <summary className="cursor-pointer text-muted-foreground">Capa personalizada <span className="text-[10px]">opcional</span></summary>
                <div className="mt-3 flex gap-2">
                  <input className={field} value={coverUrl} onChange={e => setCoverUrl(e.target.value)} placeholder="https://… (JPG/PNG) ou envie" />
                  <label className="btn-secondary shrink-0 cursor-pointer text-xs">
                    {coverUploading ? <Loader2 className="size-3.5 animate-spin" /> : <UploadCloud className="size-3.5" />}
                    Enviar
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f) }} />
                  </label>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">Sem capa personalizada, o TikTok escolhe um frame do vídeo.</p>
              </details>
            </div>
          </section>

          <section className="launch-section-card">
            <span className="launch-section-kicker">2 · Mercado</span>
            <h3 className="launch-section-title">Onde a campanha pode entregar</h3>
            <div className="mt-4"><MarketSelector value={market} onChange={setMarket} languageAvailable={false} /></div>
          </section>

          <section className="launch-section-card">
            <span className="launch-section-kicker">3 · Período e investimento</span>
            <h3 className="launch-section-title">Orçamento total da campanha</h3>
            <p className="launch-section-copy">O Smart+ distribui esse valor ao longo do período para buscar mais conversões.</p>
            <div className="mt-4 launch-field-grid">
              <MoneyField label="Orçamento total" currency={currency} value={budget} onChange={setBudget} min={TIKTOK_MIN_BUDGET} hint={`Mínimo: ${fmtSpend(TIKTOK_MIN_BUDGET, currency)} no total.`} />
              <label className="flex flex-col gap-2 text-xs">
                <span className="font-medium text-foreground">Término</span>
                <input type="date" min={tomorrow} className={field} value={endDate} onChange={e => setEndDate(e.target.value)} />
                <span className="text-[11px] text-muted-foreground">{schedule.days ? `${schedule.days} dia(s) de veiculação estimada` : 'Escolha a data final'}</span>
              </label>
            </div>
          </section>
        </fieldset>

        <aside className="launch-review" aria-label="Revisão Smart+">
          <div className="launch-review-head">
            <div>
              <p className="launch-review-title">Revisão Smart+</p>
              <p className="launch-review-copy">Visão rápida do que será criado.</p>
            </div>
            <span className="launch-review-badge">Pausada</span>
          </div>

          {coverUrl ? (
            <div className="launch-preview-card">
              <div className="launch-preview-media"><img src={coverUrl} alt="Prévia da capa do anúncio" /></div>
              <div className="launch-preview-body"><strong>{name.trim() || 'Smart+ automatizada'}</strong><p>{body.trim() || 'O texto poderá ser otimizado pelo TikTok conforme a entrega.'}</p></div>
            </div>
          ) : (
            <div className="launch-preview-card">
              <div className="launch-preview-media"><Video className="size-7 text-muted-foreground" /></div>
              <div className="launch-preview-body"><strong>{videoUrl ? 'Vídeo selecionado' : 'Aguardando criativo'}</strong><p>{body.trim() || 'A prévia final depende do vídeo e da otimização Smart+.'}</p></div>
            </div>
          )}

          <div className="launch-review-list">
            <div className="launch-review-row"><span>Objetivo</span><strong>Conversões</strong></div>
            <div className="launch-review-row"><span>Mercado</span><strong>{market.countries.join(', ') || '—'}</strong></div>
            <div className="launch-review-row"><span>Duração</span><strong>{schedule.days ? `${schedule.days} dia(s)` : '—'}</strong></div>
            <div className="launch-review-row"><span>Destino</span><strong>{linkUrl ? linkUrl.replace(/^https?:\/\//, '').split('/')[0] : '—'}</strong></div>
            <div className="launch-review-row"><span>Entrega</span><strong>Automática</strong></div>
          </div>

          <div className="launch-review-total">
            <span className="text-[11px] text-muted-foreground">Investimento total</span>
            <strong>{Number(budget) > 0 ? fmtSpend(Number(budget), currency) : '—'}</strong>
            <p className="mt-1 text-[10px] text-muted-foreground">{schedule.daily > 0 ? `Média aproximada de ${fmtSpend(schedule.daily, currency)}/dia` : 'A média diária aparece após definir o período.'}</p>
          </div>

          {error ? (
            <div className="launch-review-warning"><AlertCircle className="mt-0.5 size-3.5 shrink-0" /><span>{error}</span></div>
          ) : (
            <div className="launch-review-ready"><CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /><span>Pronta para o preflight e criação no TikTok.</span></div>
          )}
        </aside>
      </div>
    </Modal>
  )
}
