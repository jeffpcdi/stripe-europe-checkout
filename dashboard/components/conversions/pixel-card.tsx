'use client'

import { useState } from 'react'
import {
  Copy,
  Check,
  Code2,
  Trash2,
  Pencil,
  Zap,
  CheckCircle2,
  Link as LinkIcon,
  Globe,
} from 'lucide-react'
import type { Pixel, Gateway, PixelCoverage } from '@/lib/types'
import { toast } from '@/lib/toast'
import { timeAgo } from '@/lib/format'

const PROVIDER_COLORS: Record<string, string> = {
  kiwify: '#22c55e',
  hotmart: '#f04e23',
  perfectpay: '#fbbf24',
  cakto: '#7c9a3d',
  stripe: '#635bff',
  vega: '#3b82f6',
  adoorei: '#e879a0',
  payt: '#0ea5a3',
  eduzz: '#0055ff',
  monetizze: '#10b981',
  braip: '#8b5cf6',
  generic: '#25f4ee',
}

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

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border/70 bg-card/60 p-4 hover:border-brand-cyan/30 hover:bg-card/90 hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-300 gap-3.5 shadow-sm">
      <div className="flex flex-col gap-3">
        {/* Topo: Nome, Status e Switch */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`size-2.5 rounded-full shrink-0 ${
                pixel.active
                  ? 'bg-emerald-400 shadow-[0_0_8px_#34d399] animate-pulse'
                  : 'bg-muted-foreground'
              }`}
            />
            <h3 className="text-sm font-bold text-foreground truncate">{pixel.name}</h3>
            {pixel.active && (
              <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 border border-emerald-500/20">
                Ativo
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleActive(pixel)}
              disabled={busy}
              className="text-[11px] font-medium px-2 py-0.5 rounded-lg border border-border/60 bg-secondary/30 hover:bg-secondary/60 text-muted-foreground hover:text-foreground transition-all"
            >
              {busy ? 'Salvando…' : pixel.active ? 'Pausar' : 'Ativar'}
            </button>
            <button
              type="button"
              onClick={() => onEditPixel(pixel)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
              title="Editar pixel"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeletePixel(pixel)}
              className="p-1.5 text-destructive/70 hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
              title="Excluir pixel"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Código do Pixel com botão Copiar */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-white/5 bg-black/40 px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[10px] uppercase font-mono text-muted-foreground">ID:</span>
            <span className="font-mono text-xs font-semibold text-brand-cyan truncate select-all">
              {pixel.pixelCode}
            </span>
          </div>
          <button
            type="button"
            onClick={() => onCopyText(pixel.pixelCode, `code-${pixel.slug}`, 'ID do Pixel copiado!')}
            className="flex items-center gap-1 rounded-lg bg-secondary/60 px-2 py-1 text-[11px] font-medium text-foreground hover:bg-secondary transition-colors shrink-0"
          >
            {copiedId === `code-${pixel.slug}` ? (
              <>
                <Check className="size-3 text-emerald-400" />
                <span className="text-[10px] text-emerald-400 font-semibold">Copiado</span>
              </>
            ) : (
              <>
                <Copy className="size-3" />
                <span className="text-[10px]">Copiar</span>
              </>
            )}
          </button>
        </div>

        {/* Checkouts Vinculados (Multi-Pixel simplificado) */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-secondary/20 p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
              <LinkIcon className="size-3 text-brand-cyan" />
              Checkouts que enviam vendas para cá
            </span>
            <button
              type="button"
              onClick={() => onOpenLinkModal(pixel)}
              className="text-[11px] font-semibold text-brand-cyan hover:underline"
            >
              {hasSpecificBindings ? 'Alterar' : 'Escolher'}
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            {hasSpecificBindings ? (
              linkedGateways.length > 0 ? (
                linkedGateways.map((gw) => (
                  <span
                    key={gw.id}
                    className="inline-flex items-center gap-1 rounded-lg bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground border border-border/50"
                  >
                    <span
                      className="size-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: PROVIDER_COLORS[gw.provider] || '#94a3b8' }}
                    />
                    <span className="truncate max-w-[130px]">{gw.name}</span>
                  </span>
                ))
              ) : (
                <span className="text-[11px] text-muted-foreground italic">
                  Nenhum checkout selecionado
                </span>
              )
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-medium text-emerald-400">

                {pixel.gatewayBindingMode === 'explicit' ? 'Sem checkout vinculado' : 'Vínculo antigo · revisar'}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs border-t border-border pt-3"><div><span className="text-muted-foreground">Última visita</span><p className="mt-1">{coverage?.lastBrowserAt ? timeAgo(coverage.lastBrowserAt) : 'Aguardando visita'}</p></div><div><span className="text-muted-foreground">Último envio</span><p className="mt-1">{coverage?.lastCapiAt ? `${coverage.lastCapiStatus === 'ok' ? 'Confirmado' : 'Ver histórico'} · ${timeAgo(coverage.lastCapiAt)}` : 'Sem envio recente'}</p></div></div>
      {!pixel.hasToken && <p className="text-xs text-warning">Configure o token de acesso para enviar eventos pelo servidor.</p>}
      {/* Rodapé de Ações: Copiar Código e Testar */}
      <div className="flex items-center justify-between border-t border-border/40 pt-3">
        <button
          type="button"
          onClick={() => onInstallPixel(pixel)}
          className="flex items-center gap-1.5 rounded-xl border border-brand-cyan/40 bg-brand-cyan/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/20 transition-all"
        >
          {copiedSnippet ? (
            <>
              <Check className="size-3.5 stroke-[3]" />
              <span>Código Copiado!</span>
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
          className="flex items-center gap-1 rounded-xl border border-border/70 bg-secondary/50 px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-secondary transition-all disabled:opacity-50"
          title="Enviar disparo de teste para verificar a conexão com o TikTok"
        >
          <Zap className="size-3 text-amber-400" />
          {isTesting ? 'Testando…' : 'Testar'}
        </button>
      </div>
    </div>
  )
}
