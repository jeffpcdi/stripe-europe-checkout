'use client'

import { useState } from 'react'
import {
  Copy,
  Check,
  Code2,
  Trash2,
  Pencil,
  Zap,
} from 'lucide-react'
import type { Pixel, Gateway, PixelCoverage } from '@/lib/types'
import { toast } from '@/lib/toast'
import { timeAgo } from '@/lib/format'

interface PixelCardProps {
  pixel: Pixel
  coverage?: PixelCoverage
  busy?: boolean
  gatewaysById: Map<string, Gateway>
  copiedId: string | null
  testingPixelSlug: string | null
  onCopyText: (text: string, id: string, label?: string) => void
  onToggleActive: (pixel: Pixel) => void
  onTestPixel: (pixel: Pixel) => void
  onEditPixel: (pixel: Pixel) => void
  onDeletePixel: (pixel: Pixel) => void
  onInstallPixel: (pixel: Pixel) => void
  onOpenLinkModal: (pixel: Pixel) => void
}

export function PixelCard({
  pixel, coverage, busy,
  gatewaysById,
  copiedId,
  testingPixelSlug,
  onCopyText,
  onToggleActive,
  onTestPixel,
  onEditPixel,
  onDeletePixel,
  onInstallPixel,
  onOpenLinkModal,
}: PixelCardProps) {
  const [copiedSnippet, setCopiedSnippet] = useState(false)
  const boundIds = Array.isArray(pixel.gatewayIds) ? pixel.gatewayIds : []
  const hasSpecificBindings = boundIds.length > 0
  const linkedGateways = boundIds
    .map((id) => gatewaysById.get(id))
    .filter(Boolean) as Gateway[]

  const isTesting = testingPixelSlug === pixel.slug

  // Tag de instalação de 1 linha para o site
  const pixelUrl = pixel.scriptUrl || (pixel.token ? `/px/${pixel.token}.js` : '')
  const scriptTag = pixelUrl
    ? `<script src="${pixelUrl}" defer></script>`
    : pixel.scriptTag || ''

  function handleQuickCopyScript() {
    if (!scriptTag) {
      onInstallPixel(pixel)
      return
    }
    navigator.clipboard.writeText(scriptTag).then(() => {
      setCopiedSnippet(true)
      toast.success('Código copiado!', {
        hint: 'Cole dentro da tag <head> da sua página de vendas.',
      })
      setTimeout(() => setCopiedSnippet(false), 2500)
    })
  }

  const checkoutSummary = hasSpecificBindings
    ? linkedGateways.length > 0
      ? linkedGateways.map((gateway) => gateway.name).join(' · ')
      : 'Nenhum checkout selecionado'
    : pixel.gatewayBindingMode === 'explicit'
      ? 'Nenhum checkout vinculado'
      : 'Vínculo antigo · revisar'

  const checkoutNeedsReview = !hasSpecificBindings && pixel.gatewayBindingMode !== 'explicit'
  const lastCapiOk = coverage?.lastCapiStatus === 'ok'

  return (
    <div className="flex flex-col gap-4 rounded-2xl border border-border/60 bg-card/45 p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{pixel.name}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs">
            <span
              className={`size-1.5 shrink-0 rounded-full ${pixel.active ? 'bg-emerald-400' : 'bg-muted-foreground/70'}`}
              aria-hidden="true"
            />
            <span className={pixel.active ? 'text-emerald-400' : 'text-muted-foreground'}>
              {pixel.active ? 'Operacional' : 'Pausado'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleActive(pixel)}
            disabled={busy}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Salvando…' : pixel.active ? 'Pausar' : 'Ativar'}
          </button>
          <button
            type="button"
            onClick={() => onEditPixel(pixel)}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-cyan/60"
            title="Editar pixel"
            aria-label={`Editar ${pixel.name}`}
          >
            <Pencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onDeletePixel(pixel)}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-destructive/50"
            title="Excluir pixel"
            aria-label={`Excluir ${pixel.name}`}
          >
            <Trash2 className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="border-t border-border/45 pt-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 sm:flex sm:items-baseline sm:gap-3">
            <span className="block text-xs text-muted-foreground">ID do Pixel</span>
            <span className="mt-1 block truncate font-mono text-[13px] text-foreground sm:mt-0" title={pixel.pixelCode}>
              {pixel.pixelCode}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onCopyText(pixel.pixelCode, `code-${pixel.slug}`, 'ID do Pixel copiado!')}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground"
          >
            {copiedId === `code-${pixel.slug}` ? (
              <>
                <Check className="size-3 text-emerald-400" />
                <span className="text-emerald-400">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span>Copiar</span>
              </>
            )}
          </button>
        </div>
      </div>

      <div className="border-t border-border/45 pt-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="block text-xs text-muted-foreground">Checkouts</span>
            <p className={`mt-1 text-[13px] leading-5 ${checkoutNeedsReview ? 'text-warning' : linkedGateways.length > 0 ? 'text-foreground' : 'text-muted-foreground'}`}>
              {checkoutSummary}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onOpenLinkModal(pixel)}
            className="shrink-0 rounded-md px-2 py-1.5 text-xs font-medium text-brand-cyan transition-colors hover:bg-brand-cyan/10"
          >
            {hasSpecificBindings ? 'Alterar' : 'Escolher'}
          </button>
        </div>
      </div>

      <div className="grid gap-3 border-t border-border/45 pt-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <span className="block text-xs text-muted-foreground">Última visita</span>
          <p className="mt-1 text-[13px] font-medium text-foreground">
            {coverage?.lastBrowserAt ? timeAgo(coverage.lastBrowserAt) : coverage?.runtimeCoverageComplete === false ? 'Histórico indisponível' : 'Aguardando visita'}
          </p>
        </div>
        <div>
          <span className="block text-xs text-muted-foreground">Último envio</span>
          <p className="mt-1 text-[13px] font-medium text-foreground">
            {coverage?.lastCapiAt ? (
              <>
                <span className={lastCapiOk ? 'text-emerald-400' : 'text-destructive'}>
                  {lastCapiOk ? 'Confirmado' : 'Ver histórico'}
                </span>
                <span className="text-muted-foreground"> · {timeAgo(coverage.lastCapiAt)}</span>
              </>
            ) : (
              'Sem envio recente'
            )}
          </p>
        </div>
      </div>

      {!pixel.hasToken ? (
        <p className="border-t border-border/45 pt-3 text-xs leading-5 text-warning">
          Token de acesso necessário para enviar eventos pelo servidor.
        </p>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-border/45 pt-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => onInstallPixel(pixel)}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand-cyan px-3 text-xs font-semibold text-background transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40"
        >
          {copiedSnippet ? (
            <>
              <Check className="size-3.5" />
              <span>Copiado</span>
            </>
          ) : (
            <>
              <Code2 className="size-3.5" />
              <span>Instalar no site</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={() => onTestPixel(pixel)}
          disabled={isTesting}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-transparent px-3 text-xs font-medium text-foreground transition-colors hover:bg-secondary/45 disabled:cursor-not-allowed disabled:opacity-50"
          title="Enviar disparo de teste para verificar a conexão com o TikTok"
        >
          <Zap className="size-3.5 text-muted-foreground" />
          {isTesting ? 'Testando…' : 'Testar conexão'}
        </button>
      </div>
    </div>
  )
}
