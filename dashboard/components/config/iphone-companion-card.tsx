'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { Copy, Loader2, Smartphone, Volume2, LayoutGrid } from 'lucide-react'
import { fetcher } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'

type CompanionStatus = {
  ok: boolean
  paired: boolean
  devices: { id: string; name: string; createdAt?: string; updatedAt?: string }[]
  apnsConfigured: boolean
}

export function IPhoneCompanionCard() {
  const { data, mutate } = useSWR<CompanionStatus>('/api/companion/status', fetcher, {
    revalidateOnFocus: true,
  })
  const [token, setToken] = useState('')
  const [loadingToken, setLoadingToken] = useState(false)

  async function revealToken() {
    setLoadingToken(true)
    try {
      const result = await fetcher('/api/companion/token') as { ok: boolean; token: string }
      setToken(result.token || '')
      await mutate()
    } catch (error) {
      toast.error?.('Não foi possível gerar o pareamento', {
        hint: error instanceof Error ? error.message : 'Tente novamente.',
      })
    } finally {
      setLoadingToken(false)
    }
  }

  async function copyToken() {
    if (!token) return
    try {
      await navigator.clipboard.writeText(token)
      toast.success('Token do Companion copiado.')
    } catch {
      toast.error?.('Não foi possível copiar o token.')
    }
  }

  const devices = data?.devices ?? []
  const pairedLabel = devices.length
    ? String(devices.length) + ' pareado' + (devices.length === 1 ? '' : 's')
    : 'Não pareado'

  return (
    <GlassCard className="overflow-hidden p-0 border-border/60">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-cyan/10 text-brand-cyan">
            <Smartphone className="size-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Companion iPhone</h2>
              <span className={devices.length ? 'rounded-full bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success' : 'rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold text-muted-foreground'}>
                {pairedLabel}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              Camada nativa para widgets do iPhone e som próprio de venda em notificações APNs.
            </p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><LayoutGrid className="size-3.5" /> Receita, vendas, ROAS e lucro no widget</span>
              <span className="inline-flex items-center gap-1.5"><Volume2 className="size-3.5" /> Chime ROI-NADOS em venda aprovada</span>
            </div>
          </div>
        </div>

        <span className={data?.apnsConfigured ? 'shrink-0 rounded-full bg-success/10 px-2.5 py-1 text-[10px] font-semibold text-success' : 'shrink-0 rounded-full bg-warning/10 px-2.5 py-1 text-[10px] font-semibold text-warning'}>
          {data?.apnsConfigured ? 'APNs pronto' : 'APNs pendente'}
        </span>
      </div>

      <div className="border-t border-border/60 px-5 py-4">
        {!token ? (
          <button
            type="button"
            onClick={revealToken}
            disabled={loadingToken}
            className="btn-secondary min-h-10 text-xs"
          >
            {loadingToken ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {data?.paired ? 'Mostrar token de pareamento' : 'Gerar token de pareamento'}
          </button>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {token}
            </code>
            <button type="button" onClick={copyToken} className="btn-secondary min-h-10 text-xs">
              <Copy className="size-3.5" /> Copiar
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] leading-relaxed text-faint">
          Use este token somente no app Companion. Ele pode ser revogado sem afetar planilhas, BI ou Web Push.
        </p>
      </div>

      {devices.length > 0 ? (
        <div className="border-t border-border/60 px-5 py-3">
          <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Aparelhos nativos</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {devices.map((device) => (
              <span key={device.id} className="rounded-full border border-border/60 bg-secondary/20 px-2.5 py-1 text-[11px] text-muted-foreground">
                {device.name || 'iPhone'}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </GlassCard>
  )
}
