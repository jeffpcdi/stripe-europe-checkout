'use client'

import {
  Copy,
  Check,
  Trash2,
  Pencil,
  Zap,
  Clock,
  AlertCircle,
  Target,
} from 'lucide-react'
import { timeAgo } from '@/lib/format'
import type { Gateway, Pixel } from '@/lib/types'

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

  const providerColor = PROVIDER_COLORS[gateway.provider] ?? PROVIDER_COLORS.generic
  const providerName = PROVIDER_LABELS[gateway.provider] ?? gateway.provider.toUpperCase()

  // Pixels que recebem deste checkout
  const listeningPixels = pixels.filter((p) => {
    const b = Array.isArray(p.gatewayIds) ? p.gatewayIds : []
    return p.active && b.includes(gateway.id)
  })

  return (
    <div className="flex flex-col justify-between rounded-2xl border border-border/70 bg-card/60 p-4 hover:border-brand-cyan/30 hover:bg-card/90 hover:shadow-[0_8px_24px_-6px_rgba(0,0,0,0.4)] transition-all duration-300 gap-3.5 shadow-sm">
      <div className="flex flex-col gap-3">
        {/* Topo: Nome, Provedor e Ações */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="size-2.5 rounded-full shrink-0"
              style={{ backgroundColor: providerColor }}
            />
            <h3 className="text-sm font-bold text-foreground truncate">{gateway.name}</h3>
            <span className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground uppercase">
              {providerName}
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => onEditGateway(gateway)}
              className="p-1.5 text-muted-foreground hover:text-foreground rounded-lg hover:bg-secondary transition-colors"
              title="Editar checkout"
            >
              <Pencil className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onDeleteGateway(gateway)}
              className="p-1.5 text-destructive/70 hover:text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
              title="Excluir checkout"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Link do Webhook para Copiar */}
        <div className="flex flex-col gap-1 rounded-xl border border-white/5 bg-black/40 p-2.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>Link do Webhook (cole na sua plataforma):</span>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              readOnly
              value={gateway.webhookUrl}
              className="w-full bg-transparent font-mono text-[11px] text-muted-foreground focus:outline-none select-all truncate"
            />
            <button
              type="button"
              onClick={() => onCopyText(gateway.webhookUrl, `gw-${gateway.id}`, 'Link copiado!')}
              className="flex items-center gap-1 rounded-lg bg-secondary px-2.5 py-1 text-[11px] font-semibold text-foreground hover:bg-secondary/80 transition-colors shrink-0"
            >
              {copiedId === `gw-${gateway.id}` ? (
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
        </div>

        {/* Pixels que recebem deste checkout */}
        <div className="flex flex-col gap-1.5 rounded-xl border border-border/50 bg-secondary/20 p-2.5">
          <div className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
            <Target className="size-3 text-brand-cyan shrink-0" />
            <span>Envia vendas para:</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            {listeningPixels.length === 0 ? (
              <span className="italic text-xs text-muted-foreground">Nenhum pixel ativo vinculado</span>
            ) : (
              listeningPixels.map((p) => (
                <span
                  key={p.slug}
                  className="inline-flex items-center gap-1 rounded-lg bg-background/80 px-2 py-0.5 text-[11px] font-medium text-foreground border border-border/50"
                >
                  <span className="size-1.5 rounded-full bg-brand-cyan shrink-0" />
                  <span className="truncate max-w-[130px]">{p.name}</span>
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Rodapé: Status do Checkout e Botão de Testar Venda */}
      <div className="flex items-center justify-between pt-2.5 border-t border-border/40 text-xs">
        <div className="flex items-center gap-1.5 truncate">
          {isGwError ? (
            <span className="text-destructive font-medium truncate flex items-center gap-1 text-[11px]">
              <AlertCircle className="size-3" /> Falha recente
            </span>
          ) : isGwOk ? (
            <span className="text-muted-foreground truncate flex items-center gap-1 text-[11px]">
              <Clock className="size-3 text-emerald-400" /> Venda {timeAgo(gateway.lastEventAt!)}
            </span>
          ) : (
            <span className="text-muted-foreground flex items-center gap-1 text-[11px]">
              <span className="size-1.5 rounded-full bg-emerald-400/80 animate-pulse" /> Aguardando webhook
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onTestGateway(gateway)}
          disabled={isTesting}
          className="flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all disabled:opacity-50 shrink-0"
          title="Valida o processamento interno, sem enviar ao TikTok e sem registrar receita."
        >
          <Zap className="size-3 text-amber-400" />
          {isTesting ? 'Simulando…' : 'Testar integração'}
        </button>
      </div>
    </div>
  )
}
