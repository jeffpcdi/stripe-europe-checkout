'use client'

// Brand Identity — nome + avatar exibidos nos anúncios standalone
// (CUSTOMIZED_USER). Salva via PATCH /api/ads/identity; o avatar pode ser
// enviado por upload (Vercel Blob) ou por URL pública.

import { useEffect, useMemo, useRef, useState } from 'react'
import { X, UserRound, Loader2, UploadCloud } from 'lucide-react'
import { apiSend, adsUpload, apiErrorHint } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsIdentity } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { useModalA11y } from '@/lib/use-modal-a11y'

export function IdentityDialog({
  open,
  onClose,
  identity,
  onSaved,
}: {
  open: boolean
  onClose: () => void
  identity: AdsIdentity | null
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [displayName, setDisplayName] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [uploading, setUploading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useModalA11y(open, ref, submitting ? () => {} : onClose)

  useEffect(() => {
    if (open) {
      setDisplayName(identity?.displayName ?? '')
      setImageUrl(identity?.imageUrl ?? '')
    }
  }, [open, identity])

  const error: string | null = useMemo(() => {
    if (!displayName.trim()) return 'Informe o nome exibido nos anúncios'
    if (!/^https:\/\/\S+/.test(imageUrl.trim())) return 'Adicione o avatar (URL https ou upload)'
    return null
  }, [displayName, imageUrl])

  async function handleUpload(file: File) {
    if (!file.type.startsWith('image/')) {
      toast.error('Envie uma imagem (JPG/PNG)')
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Imagem acima de 10 MB')
      return
    }
    setUploading(true)
    try {
      const { url } = await adsUpload(file, 'image')
      setImageUrl(url)
      toast.success('Avatar enviado')
    } catch (e) {
      toast.error('Falha no upload do avatar', { hint: apiErrorHint(e) })
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit() {
    setSubmitting(true)
    try {
      await apiSend('/api/ads/identity', 'PATCH', {
        displayName: displayName.trim(),
        imageUrl: imageUrl.trim(),
      })
      toast.success('Brand Identity salva', { hint: 'Novos anúncios podem anunciar com essa identidade.' })
      onSaved()
    } catch (e) {
      toast.error('Falha ao salvar identidade', { hint: apiErrorHint(e) })
    } finally {
      setSubmitting(false)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Brand Identity" tabIndex={-1} className="w-full max-w-sm outline-none">
        <GlassCard className="anim-pop-in flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <UserRound className="size-4 text-primary" aria-hidden="true" />
              Brand Identity
            </h2>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} disabled={submitting} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
            Nome e avatar exibidos como “anunciante” nos anúncios criados do zero — sem precisar postar
            na conta TikTok conectada.
          </p>

          {/* Preview ao vivo */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
            {imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Avatar da identidade" className="size-10 rounded-full object-cover" />
            ) : (
              <span className="flex size-10 items-center justify-center rounded-full bg-secondary">
                <UserRound className="size-5 text-muted-foreground" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{displayName || 'Nome da marca'}</p>
              <p className="text-[11px] text-muted-foreground">Patrocinado</p>
            </div>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Nome exibido</span>
            <input
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={100}
              placeholder="Sua Marca"
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-medium text-foreground">Avatar</span>
            <input
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…/avatar.png"
              aria-label="URL pública do avatar"
            />
            <label
              className={`flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed px-3 py-3 text-xs font-medium transition-colors ${
                uploading ? 'border-primary/50 bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:border-primary/40 hover:bg-secondary/40'
              }`}
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                disabled={uploading}
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleUpload(f)
                  e.target.value = ''
                }}
              />
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <UploadCloud className="size-4" aria-hidden="true" />
              )}
              {uploading ? 'Enviando…' : 'ou envie uma imagem'}
            </label>
          </div>

          {error && (
            <p className="text-[11px] font-medium text-error" role="alert">
              {error}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={submitting}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={handleSubmit} disabled={submitting || Boolean(error)}>
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  Salvando…
                </>
              ) : (
                'Salvar identidade'
              )}
            </button>
          </div>
        </GlassCard>
      </div>
    </div>
  )
}
