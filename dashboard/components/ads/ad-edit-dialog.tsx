'use client'

import { Modal } from '@/components/ui/modal'
import { useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsTreeAd } from '@/lib/types'
import { TIKTOK_CTA_OPTIONS } from './tiktok-contracts'

// Edita um anúncio existente sem recriar. O patch continua parcial: somente
// campos realmente alterados são enviados ao endpoint já existente.
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
  const [name, setName] = useState(ad?.name ?? '')
  const [text, setText] = useState(ad?.creative?.body ?? '')
  const [linkUrl, setLinkUrl] = useState(ad?.creative?.linkUrl ?? '')
  const [cta, setCta] = useState('')
  const [saving, setSaving] = useState(false)

  if (!ad) return null

  const adId = ad.platformAdId || ad._id || ''
  const productLink = Boolean(ad.catalogId) && (
    String(ad.websiteType || '').toUpperCase() === 'PRODUCT_LINK'
    || String(ad.adFormat || '').toUpperCase() === 'CATALOG_CAROUSEL'
  )
  const initialName = ad.name ?? ''
  const initialText = ad.creative?.body ?? ''
  const initialLink = ad.creative?.linkUrl ?? ''
  const trimmedLink = linkUrl.trim()
  const linkInvalid = !productLink && trimmedLink !== '' && !/^https?:\/\/\S+/.test(trimmedLink)
  const hasChanges = Boolean(
    (name.trim() && name.trim() !== initialName)
    || text !== initialText
    || (!productLink && trimmedLink && trimmedLink !== initialLink)
    || cta,
  )

  async function handleSave() {
    if (linkInvalid || !hasChanges) return
    const creative: Record<string, string> = {}
    if (name.trim() && name.trim() !== initialName) creative.name = name.trim()
    if (text !== initialText) creative.text = text
    if (!productLink && trimmedLink && trimmedLink !== initialLink) creative.linkUrl = trimmedLink
    if (cta) creative.callToAction = cta

    setSaving(true)
    try {
      const res = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(adId)}`, 'PUT', {
        creative,
        adAccountId,
      })
      if (res.dryRun) toast.info('Modo teste: nada foi enviado ao TikTok')
      else toast.success('Anúncio atualizado', { hint: 'A alteração foi enviada e pode iniciar uma nova revisão no TikTok.' })
      onSaved()
      onClose()
    } catch (error) {
      toast.error('Falha ao atualizar o anúncio', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  const field = 'h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/10'

  return (
    <Modal
      isOpen={Boolean(ad)}
      onClose={onClose}
      busy={saving}
      title="Editar anúncio"
      description="Somente os campos alterados serão enviados ao TikTok. Alterações podem iniciar uma nova revisão do anúncio."
      footer={(
        <div className="flex flex-col gap-3 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs leading-relaxed text-muted-foreground">
            {productLink
              ? 'O destino deste anúncio é definido nos produtos do catálogo.'
              : hasChanges
                ? 'Revise os campos alterados antes de salvar.'
                : 'Altere pelo menos um campo para habilitar o salvamento.'}
          </p>
          <button type="button" className="btn-primary min-h-10 shrink-0 text-xs" onClick={handleSave} disabled={saving || linkInvalid || !hasChanges}>
            {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
            Salvar
          </button>
        </div>
      )}
    >
      <fieldset disabled={saving} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground">Nome do anúncio</span>
          <input className={field} value={name} onChange={(event) => setName(event.target.value)} maxLength={512} />
        </label>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground">Texto do anúncio</span>
          <textarea className={`${field} min-h-24 resize-y py-3`} value={text} onChange={(event) => setText(event.target.value)} maxLength={100} placeholder="Chamada curta que aparece no anúncio" />
          <span className="text-xs text-muted-foreground">{text.length}/100</span>
        </label>

        <div className={productLink ? '' : 'grid gap-4 md:grid-cols-2'}>
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="font-medium text-foreground">Botão (CTA)</span>
            <select className={field} value={cta} onChange={(event) => setCta(event.target.value)}>
              <option value="">Manter atual</option>
              {TIKTOK_CTA_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>

          {!productLink ? (
            <label className="flex flex-col gap-1.5 text-xs">
              <span className="font-medium text-foreground">Link de destino</span>
              <input className={`${field} ${linkInvalid ? 'border-error/60 focus:border-error/70 focus:ring-error/10' : ''}`} value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://…" />
              {linkInvalid ? <span className="text-xs text-error">O link precisa começar com http:// ou https://.</span> : <span className="text-xs text-muted-foreground">O destino só é enviado se este campo for alterado.</span>}
            </label>
          ) : null}
        </div>

        {productLink ? (
          <div className="border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground">
            <strong className="font-medium text-foreground">Destino controlado pelo catálogo.</strong> O link deste anúncio vem dos produtos selecionados e não pode ser substituído aqui.
          </div>
        ) : null}
      </fieldset>
    </Modal>
  )
}
