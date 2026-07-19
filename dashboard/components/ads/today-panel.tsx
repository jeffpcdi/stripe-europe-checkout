'use client'

// Aba "Hoje" — o centro de comando do gestor. Responde as 3 perguntas do dia,
// de cima para baixo: (1) o que precisa de mim? (inbox de decisões) →
// (2) como estou indo? (KPIs + ROAS real + briefing) → (3) o que o robô fez?
// (feed). Mais atalhos de criação. Tudo é REUSO — zero lógica nova de dados.

import { Plus, Zap, Layers, Sparkles, ChevronRight } from 'lucide-react'
import { useAdsRules } from '@/lib/api'
import type { KpiRowData } from './kpi-row'
import { GlassCard } from '@/components/glass-card'
import { NeedsYouInbox } from './needs-you-inbox'
import { KpiRow } from './kpi-row'
import { RoasCard } from './roas-card'
import { BriefingCard } from './briefing-card'
import { RulesLogList } from './rules-log-list'

export function TodayPanel({
  active,
  adAccountId,
  currency,
  kpi,
  fromDate,
  toDate,
  onOpenOps,
  onOpenHealth,
  onGoAutomations,
  onCreate,
  onBulk,
  onSpark,
  onNewSmartPlus,
}: {
  active: boolean
  adAccountId: string
  currency: string
  kpi: KpiRowData
  fromDate: string
  toDate: string
  onOpenOps: () => void
  onOpenHealth: () => void
  onGoAutomations: () => void
  onCreate: () => void
  onBulk: () => void
  onSpark: () => void
  onNewSmartPlus: () => void
}) {
  const { data: rulesData } = useAdsRules(active)

  return (
    <div className="flex flex-col gap-4">
      {/* 1) O que precisa de mim */}
      <NeedsYouInbox
        active={active}
        onOpenOps={onOpenOps}
        onOpenHealth={onOpenHealth}
        onGoAutomations={onGoAutomations}
      />

      {/* Atalhos de criação — a ação mais comum a um clique */}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn-primary text-xs" onClick={onCreate}>
          <Plus className="size-3.5" aria-hidden="true" /> Nova campanha
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onNewSmartPlus}>
          <Sparkles className="size-3.5" aria-hidden="true" /> Nova Smart+
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onBulk}>
          <Layers className="size-3.5" aria-hidden="true" /> Subir em massa
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onSpark}>
          <Zap className="size-3.5" aria-hidden="true" /> Spark Ads
        </button>
      </div>

      {/* 2) Como estou indo */}
      <KpiRow kpi={kpi} currency={currency} active={active} adAccountId={adAccountId} fromDate={fromDate} toDate={toDate} />
      <RoasCard active={active} adAccountId={adAccountId} />
      <BriefingCard adAccountId={adAccountId} currency={currency} />

      {/* 3) O que o robô fez */}
      <GlassCard className="p-4" data-tour="ads-feed">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">O que o robô fez</h3>
          <button type="button" className="btn-ghost gap-1 text-[11px]" onClick={onGoAutomations}>
            Ver tudo <ChevronRight className="size-3" aria-hidden="true" />
          </button>
        </div>
        <RulesLogList
          log={rulesData?.log ?? []}
          limit={6}
          emptyText="O robô ainda não agiu. Configure os pilotos na aba Automações para ele começar a cuidar das suas campanhas."
        />
      </GlassCard>
    </div>
  )
}
