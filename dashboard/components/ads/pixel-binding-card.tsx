'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { apiSend, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'

export function PixelBindingCard({ active, advertiserId }: { active: boolean; advertiserId: string }) {
  const { data, error, isLoading, mutate } = useAdsTikTokPixels(active, advertiserId)
  const [pixelId, setPixelId] = useState('')
  const [saving, setSaving] = useState(false)
  const [creating, setCreating] = useState(false)
  const choices = data?.pixels ?? []

  useEffect(() => {
    if (!pixelId && choices.length === 1) setPixelId(choices[0].id)
  }, [choices, pixelId])

  useEffect(() => setPixelId(''), [advertiserId])

  if (!active || isLoading || (data?.ready && data?.capiReady && !error)) return null

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

  async function createPixel() {
    setCreating(true)
    try {
      const result = await apiSend<{
        ok: boolean
        dryRun?: boolean
        reused?: boolean
        localPixelCreated?: boolean
      }>('/api/ads/pixels', 'POST', {
        adAccountId: advertiserId,
        pixelName: 'ROI-NADOS — Vendas',
      })
      if (result.dryRun) {
        toast.info('Modo simulação: nenhum Pixel foi criado no TikTok.')
        return
      }
      await mutate()
      toast.success(result.reused ? 'Pixel existente vinculado' : 'Pixel criado e vinculado', {
        hint: 'Conclua o server-side em Conversões para ativar a Events API.',
      })
    } catch (createError) {
      toast.error('Não foi possível criar o Pixel', {
        hint: createError instanceof Error ? createError.message : undefined,
      })
    } finally {
      setCreating(false)
    }
  }

  if (data?.ready && !data.capiReady && !error) {
    const localReady = Boolean(data.localPixelSlug)
    return (
      <section className="border-b border-border/60 pb-4" aria-label="Prontidão do Pixel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Pixel vinculado</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              {localReady
                ? 'Campanhas prontas. Falta concluir o envio server-side para a configuração recomendada.'
                : 'Campanhas prontas. O TikTok ainda está confirmando os dados necessários para o server-side.'}
            </p>
          </div>
          {localReady ? (
            <Link href="/conversions?tab=pixels" className="btn-secondary h-10 shrink-0 text-sm">
              Concluir server-side
            </Link>
          ) : (
            <button type="button" className="btn-secondary h-10 shrink-0 text-sm" disabled={creating} onClick={() => void createPixel()}>
              {creating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Sincronizar Pixel
            </button>
          )}
        </div>
      </section>
    )
  }

  return (
    <section className="border-b border-border/60 pb-4" aria-label="Vínculo do Pixel">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Antes de criar campanhas</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {choices.length ? 'Escolha o Pixel que esta conta utilizará.' : 'Nenhum Pixel disponível nesta conta.'}
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
              {choices.map((pixel) => <option key={pixel.id} value={pixel.id}>{pixel.name}</option>)}
            </select>
            <button type="button" className="btn-primary h-10 text-sm" disabled={!pixelId || saving} onClick={() => void save()}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              Usar Pixel
            </button>
          </div>
        ) : error ? (
          <button type="button" className="btn-secondary h-10 text-sm" onClick={() => void mutate()}>
            Tentar novamente
          </button>
        ) : (
          <button type="button" className="btn-primary h-10 shrink-0 text-sm" disabled={creating} onClick={() => void createPixel()}>
            {creating && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            Criar Pixel
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-error">Não foi possível conferir os Pixels desta conta agora.</p>}
    </section>
  )
}
