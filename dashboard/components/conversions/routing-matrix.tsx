'use client'

import { useMemo } from 'react'
import {
  Target,
  CreditCard,
  ArrowRight,
  ShieldCheck,
  Zap,
  Sparkles,
  Link as LinkIcon,
  Plus,
  CheckCircle2,
} from 'lucide-react'
import type { Pixel, Gateway } from '@/lib/types'

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

interface RoutingMatrixProps {
  pixels: Pixel[]
  gateways: Gateway[]
  gatewaysById: Map<string, Gateway>
  onOpenLinkModal: (pixel: Pixel) => void
  onNewPixel: () => void
  onNewGateway: () => void
}

export function RoutingMatrix({
  pixels,
  gateways,
  gatewaysById,
  onOpenLinkModal,
  onNewPixel,
  onNewGateway,
}: RoutingMatrixProps) {
  // Análise dos pares de conexão
  const mappingSummary = useMemo(() => {
    let boundPairs = 0
    let unboundPixels = 0

    for (const px of pixels) {
      if (Array.isArray(px.gatewayIds) && px.gatewayIds.length > 0) {
        boundPairs += px.gatewayIds.length
      } else {
        unboundPixels += 1
      }
    }

    return {
      boundPairs,
      unboundPixels,
      totalPixels: pixels.length,
      totalGateways: gateways.length,
    }
  }, [pixels, gateways])

  return (
    <div className="flex flex-col gap-6">
      {/* ── Banner de Explicação da Arquitetura Multi-Pixel e Multi-Gateway ── */}
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-card/80 via-card/50 to-brand-cyan/5 p-5 backdrop-blur-md shadow-lg">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-start gap-3.5 max-w-2xl">
            <div className="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30 shadow-[0_0_16px_rgba(34,211,238,0.2)]">
              <Zap className="size-5" />
            </div>
            <div className="flex flex-col gap-1">
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                Roteamento Inteligente de Conversões Server-Side
                <span className="rounded-full bg-brand-cyan/10 border border-brand-cyan/30 px-2 py-0.5 text-[10px] font-mono text-brand-cyan">
                  Multi-Pixel & Multi-Gateway
                </span>
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Você pode cadastrar múltiplos pixels do TikTok e múltiplos checkouts (Kiwify, Hotmart, Stripe, Cakto, etc.). Cada pixel pode escutar vendas de checkouts específicos para garantir que campanhas e ofertas diferentes nunca misturem conversões.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 self-end md:self-center">
            <button
              type="button"
              onClick={onNewGateway}
              className="flex items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-400 hover:bg-emerald-500/20 transition-all"
            >
              <Plus className="size-3.5" />
              <span>Novo Checkout</span>
            </button>
            <button
              type="button"
              onClick={onNewPixel}
              className="btn-primary shadow-[0_0_14px_rgba(34,211,238,0.2)]"
            >
              <Plus className="size-3.5 stroke-[2.5]" />
              <span>Novo Pixel</span>
            </button>
          </div>
        </div>

        {/* Mini KPIs de Mapeamento */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5 pt-4 border-t border-white/5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Pixels Ativos
            </span>
            <span className="text-lg font-bold text-foreground font-mono">
              {pixels.filter((p) => p.active).length}{' '}
              <span className="text-xs text-muted-foreground font-normal">/ {pixels.length}</span>
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Checkouts Cadastrados
            </span>
            <span className="text-lg font-bold text-emerald-400 font-mono">
              {gateways.length}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Vínculos Específicos
            </span>
            <span className="text-lg font-bold text-brand-cyan font-mono">
              {mappingSummary.boundPairs}
            </span>
          </div>

          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              Pixels Universais
            </span>
            <span className="text-lg font-bold text-amber-400 font-mono">
              {mappingSummary.unboundPixels}
            </span>
          </div>
        </div>
      </div>

      {/* ── Visualização das Relações Pixel ↔ Gateways ── */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
              <LinkIcon className="size-4 text-brand-cyan" />
              Mapeamento de Fluxo por Pixel
            </h3>
            <p className="text-xs text-muted-foreground">
              Veja exatamente quais checkouts alimentam cada um dos seus pixels do TikTok.
            </p>
          </div>
        </div>

        {pixels.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-dashed border-border/80 bg-card/40">
            <Target className="size-8 text-muted-foreground/60 mb-2" />
            <h4 className="text-xs font-bold text-foreground">Nenhum pixel cadastrado</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-sm">
              Cadastre seu primeiro pixel do TikTok para visualizar as conexões e rotear conversões.
            </p>
            <button
              type="button"
              onClick={onNewPixel}
              className="btn-primary mt-3 text-xs"
            >
              <Plus className="size-3.5" />
              Cadastrar Pixel
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3.5">
            {pixels.map((px) => {
              const boundIds = Array.isArray(px.gatewayIds) ? px.gatewayIds : []
              const hasSpecificBindings = boundIds.length > 0
              const linkedGateways = boundIds
                .map((id) => gatewaysById.get(id))
                .filter(Boolean) as Gateway[]

              return (
                <div
                  key={px.slug}
                  className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 rounded-2xl border border-border/70 bg-card/60 hover:bg-card/90 hover:border-border transition-all shadow-sm"
                >
                  {/* Lado Esquerdo: Info do Pixel */}
                  <div className="flex items-start sm:items-center gap-3 min-w-0 sm:min-w-[280px]">
                    <div
                      className={`flex size-10 shrink-0 items-center justify-center rounded-xl font-bold text-xs ${
                        px.active
                          ? 'bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/30'
                          : 'bg-secondary text-muted-foreground'
                      }`}
                    >
                      <Target className="size-5" />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold text-foreground truncate">{px.name}</span>
                        {px.hasToken ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold text-emerald-400 border border-emerald-500/20">
                            <ShieldCheck className="size-2.5" /> CAPI Ativa
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[9px] font-medium text-muted-foreground">
                            Navegador
                          </span>
                        )}
                        <span
                          className={`size-2 rounded-full ${
                            px.active ? 'bg-success shadow-[0_0_6px_var(--success)]' : 'bg-muted-foreground'
                          }`}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground truncate">
                        {px.pixelCode}
                      </span>
                    </div>
                  </div>

                  {/* Centro: Indicador Visual de Fluxo */}
                  <div className="hidden lg:flex items-center justify-center px-2 text-muted-foreground/40">
                    <ArrowRight className="size-4" />
                  </div>

                  {/* Lado Direito: Gateways Vinculados */}
                  <div className="flex-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 min-w-0 rounded-xl bg-black/30 border border-white/5 p-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="text-[10px] font-medium text-muted-foreground/80 uppercase tracking-wider">
                        Checkouts que disparam para este pixel:
                      </span>

                      {hasSpecificBindings ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {linkedGateways.map((gw) => (
                            <span
                              key={gw.id}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/80 border border-border/60 px-2.5 py-1 text-xs font-medium text-foreground"
                            >
                              <span
                                className="size-2 rounded-full shrink-0"
                                style={{ backgroundColor: PROVIDER_COLORS[gw.provider] || '#94a3b8' }}
                              />
                              <span className="truncate max-w-[150px]">{gw.name}</span>
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                          <Sparkles className="size-3.5 shrink-0" />
                          <span>Recebe de todos os checkouts da conta (Universal)</span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenLinkModal(px)}
                      className="flex items-center justify-center gap-1.5 self-start sm:self-auto rounded-xl border border-brand-cyan/30 bg-brand-cyan/10 px-3 py-1.5 text-xs font-semibold text-brand-cyan hover:bg-brand-cyan/20 transition-all shrink-0"
                    >
                      <LinkIcon className="size-3.5" />
                      <span>{hasSpecificBindings ? 'Alterar Vínculos' : 'Vincular Checkouts'}</span>
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Mapeamento Inverso: De Checkout para Pixels ── */}
      {gateways.length > 0 && (
        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                <CreditCard className="size-4 text-emerald-400" />
                Destinos de Notificação por Checkout
              </h3>
              <p className="text-xs text-muted-foreground">
                Qual pixel recebe compras quando cada plataforma envia o webhook.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {gateways.map((gw) => {
              // Encontra quais pixels escutam este gateway
              const listeningPixels = pixels.filter((p) => {
                const b = Array.isArray(p.gatewayIds) ? p.gatewayIds : []
                // Se o pixel é específico para este gateway, ele escuta
                if (b.length > 0) {
                  return b.includes(gw.id)
                }
                // Se o pixel é universal (sem gatewayIds específicos)
                return true
              })

              return (
                <div
                  key={gw.id}
                  className="flex flex-col justify-between gap-3 p-3.5 rounded-2xl border border-border/70 bg-card/50 hover:bg-card/80 transition-all"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="size-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: PROVIDER_COLORS[gw.provider] || '#94a3b8' }}
                      />
                      <span className="text-xs font-bold text-foreground truncate">{gw.name}</span>
                      <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[9px] font-mono uppercase text-muted-foreground">
                        {gw.provider}
                      </span>
                    </div>

                    <div className="flex flex-col gap-1 bg-black/30 border border-white/5 rounded-xl p-2.5">
                      <span className="text-[10px] text-muted-foreground font-medium">
                        Alimenta {listeningPixels.length} pixel(s):
                      </span>
                      <div className="flex items-center gap-1 flex-wrap">
                        {listeningPixels.length === 0 ? (
                          <span className="text-[11px] text-muted-foreground italic">
                            Nenhum pixel ativo escutando
                          </span>
                        ) : (
                          listeningPixels.map((p) => (
                            <span
                              key={p.slug}
                              className="inline-flex items-center gap-1 rounded bg-secondary/70 border border-border/40 px-2 py-0.5 text-[10px] font-medium text-foreground"
                            >
                              <CheckCircle2 className="size-2.5 text-emerald-400" />
                              {p.name}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
