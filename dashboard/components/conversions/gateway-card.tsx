'use client'

import { Copy, Check, Trash2, Pencil } from 'lucide-react'
import { timeAgo } from '@/lib/format'
import type { Gateway, Pixel } from '@/lib/types'

const PROVIDER_LABELS: Record<string, string> = {
  kiwify: 'Kiwify',
  hotmart: 'Hotmart',
  perfectpay: 'PerfectPay',
  cakto: 'Cakto',
  stripe: 'Stripe',
  vega: 'Vega Checkout',
  adoorei: 'Adoorei',
  payt: 'PayT',
  eduzz: 'Eduzz',
  monetizze: 'Monetizze',
  braip: 'Braip',
  generic: 'Outro Checkout',
}

interface GatewayCardProps {
  gateway: Gateway
  pixels: Pixel[]
  copiedId: string | null
  testingGwId: string | null
  onCopyText: (text: string, id: string, label?: string) => void
  onTestGateway: (gateway: Gateway) => void
  onEditGateway: (gateway: Gateway) => void
  onDeleteGateway: (gateway: Gateway) => void
}

export function GatewayCard({
  gateway,
  pixels,
  copiedId,
  testingGwId,
  onCopyText,
  onTestGateway,
  onEditGateway,
  onDeleteGateway,
}: GatewayCardProps) {
  const isGwError = gateway.lastEventStatus === 'error' || gateway.lastEventStatus === 'falhou'
  const isGwOk = !isGwError && Boolean(gateway.lastEventAt)
  const isTesting = testingGwId === gateway.id
  const providerName = PROVIDER_LABELS[gateway.provider] ?? gateway.provider

  // Mantém a regra existente: apenas pixels ativos e vinculados aparecem aqui.
  const listeningPixels = pixels.filter((p) => {
    const b = Array.isArray(p.gatewayIds) ? p.gatewayIds : []
    return p.active && b.includes(gateway.id)
  })

  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-border/55 bg-card/35 p-4 sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{gateway.name}</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">{providerName}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEditGateway(gateway)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/40"
            title="Editar checkout"
            aria-label={`Editar ${gateway.name}`}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeleteGateway(gateway)}
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/40"
            title="Excluir checkout"
            aria-label={`Excluir ${gateway.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-border/40 pt-4">
        <p className="text-xs text-muted-foreground">Webhook</p>
        <div className="mt-1.5 flex min-w-0 items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/85" title={gateway.webhookUrl}>
            {gateway.webhookUrl}
          </span>
          <button
            type="button"
            onClick={() => onCopyText(gateway.webhookUrl, `gw-${gateway.id}`, 'Link copiado!')}
            className="inline-flex min-w-[76px] shrink-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/40"
            aria-label={`Copiar webhook de ${gateway.name}`}
          >
            {copiedId === `gw-${gateway.id}` ? (
              <>
                <Check className="size-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="size-3.5" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="mt-4 border-t border-border/40 pt-4">
        <p className="text-xs text-muted-foreground">Pixels ativos vinculados</p>
        <p className="mt-1.5 text-[13px] leading-5 text-foreground/90">
          {listeningPixels.length === 0
            ? <span className="text-muted-foreground">Nenhum pixel ativo vinculado</span>
            : listeningPixels.map((p) => p.name).join(' · ')}
        </p>
      </div>

      <div className="mt-4 flex flex-col gap-3 border-t border-border/40 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          {isGwError ? (
            <>
              <span className="size-1.5 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
              <span className="font-medium text-destructive">Falha recente</span>
            </>
          ) : isGwOk ? (
            <>
              <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden="true" />
              <span className="truncate text-muted-foreground">Venda {timeAgo(gateway.lastEventAt!)}</span>
            </>
          ) : (
            <>
              <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/55" aria-hidden="true" />
              <span className="text-muted-foreground">Aguardando webhook</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={() => onTestGateway(gateway)}
          disabled={isTesting}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-transparent px-3 text-xs font-medium text-foreground transition-colors hover:border-border hover:bg-secondary/50 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/40"
          title="Valida o processamento interno, sem enviar ao TikTok e sem registrar receita."
        >
          {isTesting ? 'Testando…' : 'Testar integração'}
        </button>
      </div>
    </article>
  )
}
