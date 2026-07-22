'use client'

// Criação de campanha Smart+ — formulário único e enxuto (não um wizard). O
// TikTok automatiza targeting/lance/criativo, então o gestor só informa o
// essencial: objetivo, orçamento total + término, vídeo e destino. Tudo nasce
// PAUSADO; a criação é composta no backend (campanha → grupo → vídeo → anúncio).

import { useRef, useState } from 'react'
import { X, Loader2, Sparkles, UploadCloud, Check } from 'lucide-react'
import { apiSend, adsUpload } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'
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
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState('')
  const [budget, setBudget] = useState('')
  const [endDate, setEndDate] = useState('')
  const [countries, setCountries] = useState('BR')
  const [videoUrl, setVideoUrl] = useState('')
  const [coverUrl, setCoverUrl] = useState('')
  const [linkUrl, setLinkUrl] = useState('')
  const [body, setBody] = useState('')
  const [cta, setCta] = useState('SHOP_NOW')
  const [uploading, setUploading] = useState(false)
  const [coverUploading, setCoverUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  useModalA11y(open, ref, submitting ? () => {} : onClose)

  if (!open) return null

  const tomorrow = tomorrowLocalIsoDate()
  const endDateInFuture = /^\d{4}-\d{2}-\d{2}$/.test(endDate) && endDate >= tomorrow

  const error =
    !name.trim() ? 'Dê um nome à campanha'
      : !(Number(budget) >= TIKTOK_MIN_BUDGET) ? tiktokMinimumBudgetMessage(currency, ' no total')
        : !endDateInFuture ? 'Escolha uma data de término a partir de amanhã'
          : !/^https:\/\/\S+/.test(videoUrl.trim()) ? 'Adicione o vídeo (URL https ou upload)'
            : !/^https:\/\/\S+/.test(coverUrl.trim()) ? 'Adicione a capa do vídeo (JPG, PNG ou WebP)'
              : !/^https:\/\/\S+/.test(linkUrl.trim()) ? 'Informe o link de destino'
                : null

  async function handleUpload(file: File) {
    if (!file.type.startsWith('video/')) { toast.error('Envie um arquivo de vídeo (MP4)'); return }
    if (file.size > 500 * 1024 * 1024) { toast.error('Vídeo acima de 500 MB'); return }
    setUploading(true)
    try {
      const { url } = await adsUpload(file, 'video')
      setVideoUrl(url)
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
      const parsedCountries = countries.split(/[,\s]+/).map((c) => c.trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c))
      const res = await apiSend<{ dryRun?: boolean; warnings?: string[] }>('/api/ads/smart-plus', 'POST', {
        adAccountId: advertiserId,
        name: name.trim(),
        goal: 'conversions',
        budgetAmount: Number(budget),
        endDate,
        countries: parsedCountries,
        videoUrl: videoUrl.trim(),
        coverUrl: coverUrl.trim(),
        linkUrl: linkUrl.trim() || undefined,
        body: body.trim() || undefined,
        callToAction: cta,
      })
      if (res.dryRun) toast.info('Modo simulação: nada foi criado no TikTok')
      else toast.success('Campanha Smart+ criada (pausada)', { hint: 'Revise e ative na aba Smart+.' })
      onCreated()
      setName(''); setBudget(''); setEndDate(''); setCountries('BR'); setVideoUrl(''); setCoverUrl(''); setLinkUrl(''); setBody(''); setCta('SHOP_NOW')
      onClose()
    } catch (e) {
      toast.error('Falha ao criar Smart+', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSubmitting(false)
    }
  }

  const field = 'input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose() }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Nova campanha Smart+" tabIndex={-1} className="w-full max-w-lg outline-none">
        <div className="anim-pop-in flex max-h-[88vh] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Sparkles className="size-4 text-primary" aria-hidden="true" />
              Nova campanha Smart+
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar" disabled={submitting}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Nome da campanha</span>
              <input autoFocus className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Smart+ Verão — Conversões" maxLength={120} />
            </label>

            <p className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 text-xs text-muted-foreground">
              Conversão · compra · Pixel selecionado automaticamente · criada pausada.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Orçamento total ({currency})</span>
                <input type="number" min={TIKTOK_MIN_BUDGET} step="0.01" className={field} value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="200,00" />
                <span className="text-[10px] text-muted-foreground">Mínimo aceito pelo TikTok: {currency} {TIKTOK_MIN_BUDGET}.</span>
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Término</span>
                <input type="date" min={tomorrow} className={field} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </label>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Países</span>
              <input className={field} value={countries} onChange={(e) => setCountries(e.target.value)} placeholder="BR, PT" />
            </label>

            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Vídeo do anúncio</span>
              <div className="flex gap-2">
                <input className={field} value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://… (MP4) ou envie" />
                <label className="btn-ghost shrink-0 cursor-pointer text-xs">
                  {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                  Enviar
                  <input type="file" accept="video/mp4,video/quicktime" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
                </label>
              </div>
            </div>

            <div className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Capa do vídeo</span>
              <div className="flex gap-2">
                <input className={field} value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} placeholder="https://… (JPG/PNG) ou envie" />
                <label className="btn-ghost shrink-0 cursor-pointer text-xs">
                  {coverUploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                  Enviar
                  <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCoverUpload(f) }} />
                </label>
              </div>
              <span className="text-[10px] text-muted-foreground">Obrigatória pelo TikTok para criativos Smart+ em vídeo.</span>
            </div>

            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Link de destino</span>
              <input className={field} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://seusite.com/oferta" />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Texto do anúncio</span>
                <input className={field} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Chamada curta" maxLength={100} />
              </label>
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Botão (CTA)</span>
                <select className={field} value={cta} onChange={(e) => setCta(e.target.value)}>
                  {TIKTOK_CTA_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">{error || 'Cria pausada — revise antes de ativar.'}</p>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSubmit} disabled={Boolean(error) || submitting || uploading || coverUploading}>
              {submitting ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Criar campanha
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
