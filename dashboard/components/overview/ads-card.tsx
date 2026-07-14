'use client'

// Card TikTok Ads na Visão Geral — gasto, vendas atribuídas e ROAS do dia,
// sem precisar entrar na aba de Ads. Auto-contido no padrão do GoalCard:
// só renderiza quando a conta TikTok Ads está conectada (some do overview
// de quem não usa a integração, sem custo de layout).

import Link from 'next/link'
import { Megaphone, ArrowUpRight } from 'lucide-react'
import { useAdsStatus, useAdsRoas } from '@/lib/api'
import { useAfterFirstPaint } from '@/lib/use-after-first-paint'
import { GlassCard } from '@/components/glass-card'
import { SparkLine } from '@/components/sparkline'

function fmtCurrency(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(v)
  } catch {
    return v.toFixed(2)
  }
}

export function AdsOverviewCard() {
  // Fase 4: status de Ads só resolve pós-first-paint (chave null até lá) —
  // mantém o load inicial no orçamento de 2 requests do hero.
  const afterFirstPaint = useAfterFirstPaint()
  const { data: status } = useAdsStatus(afterFirstPaint)
  const advertiserId = status?.advertiserId || ''
  const connected = Boolean(status?.enabled && status?.connected && advertiserId)
  // Últimos 7 dias somente do advertiser explicitamente salvo.
  const { data: roas } = useAdsRoas(connected, advertiserId)

  // Desconectado ou ainda carregando: não ocupa espaço no overview
  if (!connected || !roas) return null

  const spendSeries = roas.daily.map((d) => d.spend)
  const hasSpend = roas.spend > 0
  const roasColor =
    roas.roas === null ? 'text-muted-foreground' : roas.roas >= 1 ? 'text-success' : 'text-error'

  return (
    <GlassCard className="flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <span className="flex size-7 items-center justify-center rounded-[10px] bg-[rgba(37,244,238,.1)]">
            <Megaphone className="size-3.5 text-brand-cyan" aria-hidden="true" />
          </span>
          TikTok Ads · últimos 7 dias
        </span>
        {/* Link do Next aplica o basePath /dashboard — <a> cru caía em 404 */}
        <Link
          href="/ads/tiktok"
          className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          Ver campanhas
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <p className="text-[11px] text-muted-foreground">Investimento</p>
            <p className="text-lg font-semibold tabular-nums text-foreground" data-sensitive>
              {fmtCurrency(roas.spend, roas.currency)}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">Vendas atribuídas</p>
            <p className="text-lg font-semibold tabular-nums text-foreground">
              {roas.sales}
              {roas.revenueCents > 0 && (
                <span className="ml-1.5 text-xs font-medium text-success" data-sensitive>
                  {fmtCurrency(roas.revenueCents / 100, roas.currency)}
                </span>
              )}
            </p>
          </div>
          <div>
            <p className="text-[11px] text-muted-foreground">ROAS</p>
            <p className={`text-lg font-semibold tabular-nums ${roasColor}`}>
              {roas.roas === null ? '—' : roas.roas.toFixed(2).replace('.', ',')}
            </p>
          </div>
        </div>
        {hasSpend && spendSeries.length > 1 && (
          <SparkLine data={spendSeries} color="#25f4ee" width={96} height={30} />
        )}
      </div>

      {!hasSpend && (
        <p className="text-[11px] text-muted-foreground">
          Sem gasto no período — suas campanhas podem estar pausadas ou em revisão.
        </p>
      )}
    </GlassCard>
  )
}
