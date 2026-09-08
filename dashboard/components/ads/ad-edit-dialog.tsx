'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Editar um anúncio EXISTENTE sem recriar — texto, botão (CTA) e link de
// destino. Fecha o motivo nº 1 de abrir o TikTok Ads Manager. Patch parcial:
// só os campos preenchidos são enviados (PUT /api/ads/:adId { creative }).

import { useRef, useState } from 'react'
import { X, Loader2, Check, Pencil } from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'
import type { AdsTreeAd } from '@/lib/types'
import { TIKTOK_CTA_OPTIONS } from './tiktok-contracts'

export function AdEditDialog({
  ad,
  adAccountId,
  onClose,
  onSaved,
}: {
  ad: AdsTreeAd | null
  adAccountId: string
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [name, setName] = useState(ad?.name ?? '')
  const [text, setText] = useState(ad?.creative?.body ?? '')
  const [linkUrl, setLinkUrl] = useState(ad?.creative?.linkUrl ?? '')
  const [cta, setCta] = useState('')
  const [saving, setSaving] = useState(false)
  useModalA11y(Boolean(ad), ref, saving ? () => {} : onClose)

  if (!ad) return null
  const adId = ad.platformAdId || ad._id || ''
  const productLink = Boolean(ad.catalogId) && (
    String(ad.websiteType || '').toUpperCase() === 'PRODUCT_LINK'
    || String(ad.adFormat || '').toUpperCase() === 'CATALOG_CAROUSEL'
  )

  const linkInvalid = !productLink && linkUrl.trim() !== '' && !/^https?:\/\/\S+/.test(linkUrl.trim())

  async function handleSave() {
    if (linkInvalid) return
    const creative: Record<string, string> = {}
    if (name.trim() && name.trim() !== ad!.name) creative.name = name.trim()
    if (text !== (ad!.creative?.body ?? '')) creative.text = text
    if (!productLink && linkUrl.trim() && linkUrl.trim() !== (ad!.creative?.linkUrl ?? '')) creative.linkUrl = linkUrl.trim()
    if (cta) creative.callToAction = cta
    if (Object.keys(creative).length === 0) {
      toast.info('Nada mudou — edite algum campo antes de salvar.')
      return
    }
    setSaving(true)
    try {
      const res = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(adId)}`, 'PUT', {
        creative,
        adAccountId,
      })
      if (res.dryRun) toast.info('Modo teste: nada foi enviado ao TikTok')
      else toast.success('Anúncio atualizado', { hint: 'A revisão do TikTok pode reavaliar o anúncio.' })
      onSaved()
      onClose()
    } catch (e) {
      toast.error('Falha ao atualizar o anúncio', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  const field = 'input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground'

  return (
    <DialogPortal><div
      className="ads-dialog fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Editar anúncio" tabIndex={-1} className="w-full max-w-md outline-none">
        <div className="anim-pop-in flex flex-col gap-4 rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Pencil className="size-4 text-primary" aria-hidden="true" />
              Editar anúncio
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar" disabled={saving}>
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground">Nome do anúncio</span>
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={512} />
          </label>

          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground">Texto do anúncio</span>
            <textarea className={`${field} min-h-16 resize-y`} value={text} onChange={(e) => setText(e.target.value)} maxLength={100} placeholder="Chamada curta que aparece no anúncio" />
            <span className="text-[10px] text-muted-foreground">{text.length}/100</span>
          </label>

          <div className={`grid gap-3 ${productLink ? '' : 'grid-cols-2'}`}>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Botão (CTA)</span>
              <select className={field} value={cta} onChange={(e) => setCta(e.target.value)}>
                <option value="">Manter atual</option>
                {TIKTOK_CTA_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            {!productLink && (
              <label className="flex flex-col gap-1 text-xs">
                <span className="font-medium text-foreground">Link de destino</span>
                <input className={`${field} ${linkInvalid ? 'border-error/60' : ''}`} value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://…" />
              </label>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              {productLink ? 'Destino: Link de cada produto no catálogo.' : linkInvalid ? 'Link deve começar com http(s)://' : 'Só os campos alterados são enviados.'}
            </p>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSave} disabled={saving || linkInvalid}>
              {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div></DialogPortal>
  )
}
