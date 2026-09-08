'use client'

import { useEffect, useState } from 'react'
import { Link2, Loader2 } from 'lucide-react'
import { apiSend, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'

export function PixelBindingCard({ active, advertiserId }: { active: boolean; advertiserId: string }) {
  const { data, error, isLoading, mutate } = useAdsTikTokPixels(active, advertiserId)
  const [pixelId, setPixelId] = useState('')
  const [saving, setSaving] = useState(false)
  const choices = (data?.pixels ?? [])

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
    <section className="rounded-xl border border-warning/30 bg-warning/5 p-3" aria-label="Vínculo do Pixel">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-2.5">
          <Link2 className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-xs font-semibold text-foreground">Pixel da conta TikTok</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Escolha uma vez. As próximas campanhas usam este Pixel.
            </p>
          </div>
        </div>
        {choices.length > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-2">
            <select aria-label="Pixel de vendas" className="input min-w-0 flex-1 text-xs" value={pixelId} onChange={(event) => setPixelId(event.target.value)}>
              <option value="">Selecione o Pixel</option>
              {choices.map((pixel) => (
                <option key={pixel.id} value={pixel.id}>{pixel.name}</option>
              ))}
            </select>
            <button type="button" className="btn-primary text-xs" disabled={!pixelId || saving} onClick={() => void save()}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Usar Pixel
            </button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Compartilhe um Pixel com esta conta no TikTok Ads Manager.</p>
        )}
      </div>
      {error && <p className="mt-2 text-[10px] text-error">Não foi possível conferir os Pixels desta conta agora.</p>}
    </section>
  )
}
