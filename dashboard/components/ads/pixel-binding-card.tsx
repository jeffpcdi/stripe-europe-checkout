'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiSend, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'

export function PixelBindingCard({ active, advertiserId }: { active: boolean; advertiserId: string }) {
  const { data, error, isLoading, mutate } = useAdsTikTokPixels(active, advertiserId)
  const [pixelId, setPixelId] = useState('')
  const [saving, setSaving] = useState(false)
  const choices = data?.pixels ?? []

  useEffect(() => {
    if (!pixelId && choices.length === 1) setPixelId(choices[0].id)
  }, [choices, pixelId])

  useEffect(() => setPixelId(''), [advertiserId])

  if (!active || isLoading || (data?.ready && !error)) return null

  async function save() {
    if (!pixelId) return
    setSaving(true)
    try {
      await apiSend('/api/ads/pixels/default', 'PUT', { adAccountId: advertiserId, pixelId })
      await mutate()
      toast.success('Pixel de campanhas configurado')
    } catch (saveError) {
      toast.error('Não foi possível vincular o Pixel', {
        hint: saveError instanceof Error ? saveError.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="border-b border-border/60 pb-4" aria-label="Vínculo do Pixel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Antes de criar campanhas</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Escolha o Pixel que esta conta utilizará nas campanhas.
          </p>
        </div>
        {choices.length > 0 ? (
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <select
              aria-label="Pixel de vendas"
              className="h-10 min-w-0 flex-1 rounded-lg border border-border/70 bg-background px-3 text-sm text-foreground focus:border-primary/60 focus:outline-none focus:ring-1 focus:ring-primary/30 sm:min-w-64"
              value={pixelId}
              onChange={(event) => setPixelId(event.target.value)}
            >
              <option value="">Selecione o Pixel</option>
              {choices.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>{pixel.name}</option>
              ))}
            </select>
            <button type="button" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50" disabled={!pixelId || saving} onClick={() => void save()}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Usar Pixel
            </button>
          </div>
        ) : error ? (
          <button type="button" className="btn-secondary h-10 text-sm" onClick={() => void mutate()}>
            Tentar novamente
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">Compartilhe um Pixel com esta conta no TikTok Ads Manager.</p>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-error">Não foi possível conferir os Pixels desta conta agora.</p>}
    </section>
  )
}
