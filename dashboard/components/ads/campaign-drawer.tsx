'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'
import { useMemo, useRef, useState } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  X,
  TrendingDown,
  TrendingUp,
  History,
  BarChart3,
  Layers,
  Clapperboard,
  Bot,
  Copy,
  Pencil,
  Play,
  Pause,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  DollarSign,
  Sparkles,
  ExternalLink,
  ChevronDown,
} from 'lucide-react'
import { apiSend, useAdsAudit, useAdsCampaignAnalytics, useAdsCampaignDecisions } from '@/lib/api'
import { fmtCompact, fmtSpend, timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/skeleton'
import { StatusPill } from '@/components/ads/campaign-tree'
import type { AdsCampaignDecisionEntry, AdsMetrics, AdsTreeAd, AdsTreeCampaign } from '@/lib/types'
import { adsDateRange, previousAdsRange, shiftAdsDay } from '@/lib/ads-time'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { useReducedMotion } from '@/lib/motion'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { campaignStatusOutcome, type CampaignStatusResult } from '@/lib/campaign-metrics'
import { AdEditDialog } from './ad-edit-dialog'
import { TIKTOK_MIN_BUDGET } from './tiktok-contracts'

type Metric = 'spend' | 'conversions' | 'ctr'
type SectionKey = 'overview' | 'structure' | 'history'

const METRICS: { id: Metric; label: string; color: string }[] = [
  { id: 'spend', label: 'Gasto', color: '#25f4ee' },
  { id: 'conversions', label: 'Conversões TikTok', color: '#22c55e' },
  { id: 'ctr', label: 'CTR', color: '#fbbf24' },
]

const RANGES = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
] as const

function fmtDay(day: unknown) {
  const [, m, d] = String(day ?? '').split('-')
  return d && m ? `${d}/${m}` : String(day ?? '')
}

function fmtMetric(metric: Metric, v: number, currency: string) {
  if (metric === 'spend') return fmtSpend(v, currency)
  if (metric === 'ctr') return `${v.toFixed(2).replace('.', ',')}%`
  return fmtCompact(v)
}

function fmtMoney(value: number, currency: string) {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return value.toFixed(2)
  }
}

type Row = { day: string; spend: number; conversions: number; ctr: number; ghost?: number }

function DrawerTooltip({
  active,
  payload,
  label,
  metric,
  currency,
}: {
  active?: boolean
  payload?: { value?: number | string }[]
  label?: string
  metric: Metric
  currency: string
}) {
  if (!active || !payload?.length) return null
  const val = Number(payload[0]?.value ?? 0)
  return (
    <div className="glass glass-thick rounded-xl px-3 py-2 text-xs">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{fmtDay(label)}</p>
      <p className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-foreground">
        {fmtMetric(metric, val, currency)}
      </p>
    </div>
  )
}

function DeltaKpi({
  label,
  value,
  prev,
  invert,
  hint,
}: {
  label: string
  value: string
  prev: number | null
  invert?: boolean
  hint?: string
}) {
  const good = prev !== null && (invert ? prev <= 0 : prev >= 0)
  return (
    <div className="rounded-2xl border border-border/55 bg-secondary/15 p-3.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-foreground">{value}</p>
      {prev !== null ? (
        <p className={cn('mt-1 flex items-center gap-1 font-mono text-[10px] tabular-nums', good ? 'text-success' : 'text-error')}>
          {prev >= 0 ? <TrendingUp className="size-2.5" aria-hidden /> : <TrendingDown className="size-2.5" aria-hidden />}
          {`${prev >= 0 ? '+' : ''}${prev.toFixed(1).replace('.', ',')}%`}
          <span className="text-muted-foreground">vs. anterior</span>
        </p>
      ) : hint ? (
        <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>
      ) : (
        <p className="mt-1 text-[10px] text-faint">sem base anterior</p>
      )}
    </div>
  )
}

function sumMetrics(daily: ({ date?: string } & AdsMetrics)[] | undefined) {
  const out = { spend: 0, conversions: 0, clicks: 0, impressions: 0 }
  ;(daily || []).forEach((d) => {
    out.spend += Number(d.spend) || 0
    out.conversions += Number(d.conversions) || 0
    out.clicks += Number(d.clicks) || 0
    out.impressions += Number(d.impressions) || 0
  })
  return out
}

function pctDelta(cur: number, prev: number): number | null {
  if (!prev) return null
  return ((cur - prev) / prev) * 100
}

function automationSummary(decision: AdsCampaignDecisionEntry | undefined) {
  const proposal = decision?.automation?.pendingProposal
  if (proposal) {
    const action = String(proposal.action || '').replaceAll('_', ' ')
    return { tone: 'warning', label: 'Decisão pendente', detail: proposal.detail || `Aguardando aprovação: ${action || 'ação sugerida'}` }
  }
  const event = decision?.automation?.lastEvent
  if (event) {
    if (!event.ok) return { tone: 'error', label: 'Automação com falha', detail: event.detail || event.result || 'A última ação não foi concluída.' }
    if (event.simulated) return { tone: 'muted', label: 'Última ação simulada', detail: event.detail || event.result || 'Nenhuma alteração real foi publicada.' }
    return { tone: 'success', label: 'Automação agiu', detail: event.detail || event.result || (event.at ? timeAgo(event.at) : 'Ação concluída') }
  }
  return { tone: 'muted', label: 'Sem ação recente', detail: 'Nenhuma decisão automática recente para esta campanha.' }
}

function toneClasses(tone: string) {
  if (tone === 'success') return 'border-success/20 bg-success/8 text-success'
  if (tone === 'warning') return 'border-warning/20 bg-warning/8 text-warning'
  if (tone === 'error') return 'border-error/20 bg-error/8 text-error'
  return 'border-border/60 bg-secondary/15 text-muted-foreground'
}

export function CampaignDrawer({
  campaign,
  advertiserId,
  currency,
  onClose,
  fromDate,
  toDate,
  timeZone,
  onMutate,
  onDuplicate,
  onOpenAutomations,
}: {
  campaign: AdsTreeCampaign | null
  advertiserId: string
  currency: string
  onClose: () => void
  fromDate: string
  toDate: string
  timeZone?: string
  onMutate?: () => void | Promise<void>
  onDuplicate?: (campaign: AdsTreeCampaign) => void
  onOpenAutomations?: () => void
}) {
  const [metric, setMetric] = useState<Metric>('spend')
  const [days, setDays] = useState<number | null>(null)
  const [section, setSection] = useState<SectionKey>('overview')
  const [statusBusy, setStatusBusy] = useState(false)
  const [budgetEditing, setBudgetEditing] = useState(false)
  const [budgetValue, setBudgetValue] = useState('')
  const [budgetBusy, setBudgetBusy] = useState(false)
  const [editAd, setEditAd] = useState<AdsTreeAd | null>(null)
  const reducedMotion = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)

  const id = campaign?.platformCampaignId ?? null
  const cur = useMemo(() => days ? adsDateRange(days, timeZone) : { fromDate, toDate }, [days, timeZone, fromDate, toDate])
  const prev = useMemo(() => previousAdsRange(cur), [cur])

  const { data, isLoading, error } = useAdsCampaignAnalytics(id, advertiserId, cur)
  const { data: prevData, error: prevError } = useAdsCampaignAnalytics(id, advertiserId, prev)
  const { data: decisions, mutate: mutateDecisions } = useAdsCampaignDecisions(Boolean(id), advertiserId, cur)
  const { data: audit, error: auditError, isLoading: auditLoading } = useAdsAudit(Boolean(id))

  useModalA11y(Boolean(id), panelRef, onClose)

  if (!campaign || !id) return null

  const conf = METRICS.find((m) => m.id === metric) ?? METRICS[0]
  const ccy = campaign.currency || currency
  const decision = decisions?.byCampaign[id]
  const realSales = Number(decision?.sales) || 0
  const realRevenue = (Number(decision?.revenueCents) || 0) / 100
  const realCurrencyComparable = !decision?.currency || decision.currency === ccy

  const daily = [...(data?.daily || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const prevDaily = !prevError && !prevData?.backfillPending ? prevData?.daily || [] : []
  const previousByDate = new Map(prevDaily.map(day => [String(day.date).slice(0, 10), day]))
  const offsetDays = Math.round((Date.parse(prev.fromDate) - Date.parse(cur.fromDate)) / 864e5)
  const rows: Row[] = daily.map((d) => {
    const clicks = Number(d.clicks) || 0
    const imp = Number(d.impressions) || 0
    const p = d.date ? previousByDate.get(shiftAdsDay(String(d.date), offsetDays)) : undefined
    const pClicks = Number(p?.clicks) || 0
    const pImp = Number(p?.impressions) || 0
    const ghost = p === undefined ? undefined : metric === 'spend'
      ? Number(p.spend) || 0
      : metric === 'conversions'
        ? Number(p.conversions) || 0
        : pImp > 0 ? (pClicks / pImp) * 100 : 0
    return {
      day: String(d.date || '').slice(0, 10),
      spend: +(Number(d.spend) || 0).toFixed(2),
      conversions: Number(d.conversions) || 0,
      ctr: imp > 0 ? +((clicks / imp) * 100).toFixed(2) : 0,
      ghost,
    }
  })
  const hasGhost = rows.some((r) => r.ghost !== undefined)

  const tot = sumMetrics(daily)
  const pTot = sumMetrics(prevDaily)
  const ctrCur = tot.impressions > 0 ? (tot.clicks / tot.impressions) * 100 : 0
  const ctrPrev = pTot.impressions > 0 ? (pTot.clicks / pTot.impressions) * 100 : 0
  const cpaReal = realSales > 0 ? tot.spend / realSales : null
  const roasReal = realCurrencyComparable && tot.spend > 0 && realRevenue > 0 ? realRevenue / tot.spend : null

  const chartKey = `${metric}-${days}-${id}`
  const timeline = (audit?.events || []).filter((event) => {
    if (event.target_id === id) return true
    const meta = event.metadata || {}
    return String(meta.campaignId || meta.winnerId || meta.donorId || '') === id
  }).slice(0, 30)

  const automation = automationSummary(decision)
  const groups = campaign.adSets ?? []
  const ads = groups.flatMap((group) => group.ads ?? [])
  const rejectedAds = ads.filter((ad) => ad.status === 'rejected' || Boolean(ad.rejectionReason))
  const activeAds = ads.filter((ad) => ad.status === 'active').length
  const budgetAmount = Number(campaign.budget?.amount)
  const canEditCampaignBudget = campaign.budgetOwner === 'campaign' && Number.isFinite(budgetAmount) && budgetAmount > 0

  async function refreshAfterMutation() {
    await Promise.allSettled([
      Promise.resolve(onMutate?.()),
      mutateDecisions(),
    ])
  }

  async function handleStatusToggle() {
    if (!campaign || !id || statusBusy || !['active', 'paused'].includes(String(campaign.status))) return
    const next = campaign.status === 'active' ? 'paused' : 'active'
    setStatusBusy(true)
    try {
      const result = await apiSend<CampaignStatusResult>('/api/ads/campaigns/bulk-status', 'POST', {
        campaigns: [{ platformCampaignId: id }],
        status: next,
        adAccountId: advertiserId,
      })
      const outcome = campaignStatusOutcome(result, 1)
      if (outcome === 'simulated') toast.info('Simulação concluída', { hint: 'Modo teste: a campanha não foi alterada.' })
      else if (outcome === 'accepted') toast.info(next === 'paused' ? 'Pausa solicitada' : 'Ativação solicitada', { hint: 'O status será atualizado após a sincronização com o TikTok.' })
      else throw new Error('A alteração não foi confirmada pelo backend.')
      await refreshAfterMutation()
    } catch (e) {
      toast.error('Falha ao alterar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setStatusBusy(false)
    }
  }

  function openBudgetEditor() {
    if (!canEditCampaignBudget) return
    setBudgetValue(String(budgetAmount))
    setBudgetEditing(true)
  }

  async function saveBudget() {
    if (!campaign || !id || !canEditCampaignBudget || budgetBusy) return
    const value = Number(budgetValue.replace(',', '.'))
    if (!Number.isFinite(value) || value < TIKTOK_MIN_BUDGET) {
      toast.error(`Informe um orçamento de pelo menos ${fmtMoney(TIKTOK_MIN_BUDGET, ccy)}.`)
      return
    }
    setBudgetBusy(true)
    try {
      const result = await apiSend<{ dryRun?: boolean }>(`/api/ads/${encodeURIComponent(id)}`, 'PUT', {
        budget: { amount: value, type: campaign.budget?.type || 'daily' },
        adAccountId: advertiserId,
      })
      if (result.dryRun) toast.info('Simulação concluída', { hint: 'Modo teste: o orçamento não foi alterado.' })
      else toast.info('Orçamento enviado', { hint: 'Aguardando sincronização com o TikTok.' })
      setBudgetEditing(false)
      await refreshAfterMutation()
    } catch (e) {
      toast.error('Falha ao atualizar orçamento', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBudgetBusy(false)
    }
  }

  const sectionButton = (key: SectionKey, label: string, Icon: typeof BarChart3) => (
    <button
      type="button"
      onClick={() => setSection(key)}
      className={cn(
        'flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium transition-colors',
        section === key ? 'bg-brand-cyan/10 text-brand-cyan' : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </button>
  )

  return (
    <>
      <DialogPortal>
        <div className="ads-dialog fixed inset-0 z-50">
          <button type="button" aria-label="Fechar painel" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label="Central da campanha"
            tabIndex={-1}
            className="anim-drawer-in absolute inset-y-0 right-0 flex w-full max-w-[980px] flex-col overflow-hidden border-l border-border/60 bg-background/98 shadow-2xl outline-none"
          >
            <header className="shrink-0 border-b border-border/50 bg-card/92 px-5 py-4 backdrop-blur-xl sm:px-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-brand-cyan/20 bg-brand-cyan/10 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-brand-cyan">
                      Central da campanha
                    </span>
                    <StatusPill status={campaign.status} />
                    {campaign.campaignKind === 'smart_plus' ? <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-300">Smart+</span> : null}
                  </div>
                  <h2 className="mt-2 max-w-3xl truncate text-lg font-semibold tracking-tight text-foreground">
                    {campaign.campaignName || 'Campanha sem nome'}
                  </h2>
                  <p className="mt-1 font-mono text-[10px] text-muted-foreground">{id} · {campaign.platformAdAccountName || advertiserId}</p>
                </div>
                <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Fechar">
                  <X className="size-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 rounded-2xl border border-border/50 bg-secondary/20 p-1">
                  {sectionButton('overview', 'Resultado', BarChart3)}
                  {sectionButton('structure', 'Estrutura', Layers)}
                  {sectionButton('history', 'Histórico', History)}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {['active', 'paused'].includes(String(campaign.status)) ? (
                    <button type="button" className="btn-secondary text-xs" onClick={handleStatusToggle} disabled={statusBusy}>
                      {statusBusy ? <Loader2 className="size-3.5 animate-spin" /> : campaign.status === 'active' ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
                      {campaign.status === 'active' ? 'Pausar' : 'Ativar'}
                    </button>
                  ) : null}
                  {onDuplicate ? (
                    <button type="button" className="btn-secondary text-xs" onClick={() => onDuplicate(campaign)}>
                      <Copy className="size-3.5" /> Duplicar
                    </button>
                  ) : null}
                  {onOpenAutomations ? (
                    <button type="button" className="btn-primary text-xs" onClick={onOpenAutomations}>
                      <Bot className="size-3.5" /> Automações
                    </button>
                  ) : null}
                </div>
              </div>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
              {section === 'overview' ? (
                <div className="flex flex-col gap-5">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <DeltaKpi label="Gasto TikTok" value={data?.backfillPending ? '—' : fmtSpend(tot.spend, ccy)} prev={pctDelta(tot.spend, pTot.spend)} invert />
                    <DeltaKpi label="Vendas reais" value={decisions ? fmtCompact(realSales) : '—'} prev={null} hint="Conversões first-party do ROINADOS" />
                    <DeltaKpi label="CPA real" value={cpaReal !== null ? fmtSpend(cpaReal, ccy) : '—'} prev={null} hint="Gasto TikTok ÷ vendas reais" />
                    <DeltaKpi label="ROAS real" value={roasReal !== null ? `${roasReal.toFixed(2)}×` : '—'} prev={null} hint={realCurrencyComparable ? 'Receita real ÷ gasto TikTok' : 'Moedas diferentes no período'} />
                  </div>

                  <div className="grid gap-4 xl:grid-cols-[1.55fr,0.85fr]">
                    <GlassCard className="p-4 sm:p-5">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-foreground">Performance no período</h3>
                          <p className="mt-1 text-[11px] text-muted-foreground">Métricas da plataforma. Vendas, CPA e ROAS acima usam a atribuição real do ROINADOS.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex gap-0.5 rounded-xl bg-secondary/35 p-0.5" role="group" aria-label="Período">
                            <button type="button" aria-pressed={days === null} onClick={() => setDays(null)} className={cn('rounded-lg px-2.5 py-1.5 text-[11px]', days === null ? 'bg-foreground text-background' : 'text-muted-foreground')}>Selecionado</button>
                            {RANGES.map((r) => (
                              <button key={r.days} type="button" aria-pressed={days === r.days} onClick={() => setDays(r.days)} className={cn('rounded-lg px-2.5 py-1.5 text-[11px]', days === r.days ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{r.label}</button>
                            ))}
                          </div>
                          <div className="flex gap-0.5 rounded-xl bg-secondary/35 p-0.5" role="group" aria-label="Métrica">
                            {METRICS.map((m) => (
                              <button key={m.id} type="button" aria-pressed={metric === m.id} onClick={() => setMetric(m.id)} className={cn('rounded-lg px-2.5 py-1.5 text-[11px]', metric === m.id ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>{m.label}</button>
                            ))}
                          </div>
                        </div>
                      </div>
                      <p className="mt-3 text-[10px] text-muted-foreground">{fmtDay(cur.fromDate)} a {fmtDay(cur.toDate)}{timeZone ? ` · ${timeZone}` : ''}</p>
                      {prevError ? <p className="mt-1 text-xs text-warning">Comparação anterior indisponível.</p> : null}

                      {isLoading && !data ? (
                        <Skeleton className="mt-4 h-64 rounded-2xl" />
                      ) : error ? (
                        <div className="mt-4 rounded-2xl border border-warning/20 bg-warning/8 p-4 text-xs text-warning">{error instanceof Error ? error.message : 'Erro ao carregar as métricas.'}</div>
                      ) : rows.length === 0 ? (
                        <div className="mt-4 flex h-64 items-center justify-center rounded-2xl border border-border/50 bg-secondary/15 text-sm text-muted-foreground">
                          {data?.backfillPending ? 'Coletando métricas do TikTok…' : 'Sem dados diários no período.'}
                        </div>
                      ) : (
                        <div className="mt-4 h-64" key={chartKey}>
                          <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={rows} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                              <defs>
                                <linearGradient id={`ads-grad-${metric}`} x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor={conf.color} stopOpacity={0.3} />
                                  <stop offset="100%" stopColor={conf.color} stopOpacity={0} />
                                </linearGradient>
                              </defs>
                              <CartesianGrid stroke="rgba(255,255,255,0.04)" vertical={false} />
                              <XAxis dataKey="day" tickFormatter={fmtDay} tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} />
                              <YAxis tick={{ fill: '#a1a1aa', fontSize: 11 }} axisLine={false} tickLine={false} width={44} tickFormatter={(v: number) => fmtCompact(v)} />
                              <Tooltip cursor={{ stroke: 'rgba(37,244,238,0.35)', strokeDasharray: '4 4' }} content={<DrawerTooltip metric={metric} currency={ccy} />} />
                              {hasGhost ? <Area type="monotone" dataKey="ghost" name="Período anterior" stroke="rgba(161,161,170,0.45)" strokeWidth={1.5} strokeDasharray="5 4" fill="none" dot={false} activeDot={false} isAnimationActive={!reducedMotion} animationDuration={500} /> : null}
                              <Area type="monotone" dataKey={metric} name={conf.label} stroke={conf.color} strokeWidth={2} fill={`url(#ads-grad-${metric})`} isAnimationActive={!reducedMotion} animationDuration={700} activeDot={{ r: 4, strokeWidth: 0, fill: conf.color }} />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </GlassCard>

                    <div className="flex flex-col gap-4">
                      <GlassCard className="p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <Bot className="size-4 text-brand-cyan" />
                            <h3 className="text-sm font-semibold text-foreground">Automação</h3>
                          </div>
                          {decision?.automation.pendingProposal ? <span className="rounded-full border border-warning/20 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">Precisa de você</span> : null}
                        </div>
                        <div className={cn('mt-3 rounded-2xl border p-3', toneClasses(automation.tone))}>
                          <p className="text-xs font-semibold text-foreground">{automation.label}</p>
                          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{automation.detail}</p>
                        </div>
                        <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={onOpenAutomations} disabled={!onOpenAutomations}>
                          Ver regras e decisões
                        </button>
                      </GlassCard>

                      <GlassCard className="p-4">
                        <div className="flex items-center gap-2">
                          <DollarSign className="size-4 text-brand-cyan" />
                          <h3 className="text-sm font-semibold text-foreground">Orçamento</h3>
                        </div>
                        <div className="mt-3 rounded-2xl border border-border/60 bg-secondary/15 p-3">
                          <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{campaign.budget?.type === 'lifetime' ? 'Total' : 'Por dia'}</p>
                          <p className="mt-1 font-mono text-lg font-semibold text-foreground">{Number.isFinite(budgetAmount) ? fmtMoney(budgetAmount, ccy) : 'Definido nos conjuntos'}</p>
                          <p className="mt-1 text-[10px] text-muted-foreground">{campaign.budgetOwner === 'campaign' ? 'CBO · orçamento da campanha' : 'ABO · orçamento por conjunto'}</p>
                        </div>
                        {canEditCampaignBudget ? (
                          budgetEditing ? (
                            <div className="mt-3 flex items-center gap-2">
                              <input value={budgetValue} onChange={(e) => setBudgetValue(e.target.value)} className="input-neon min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs" inputMode="decimal" />
                              <button type="button" className="btn-primary text-xs" onClick={saveBudget} disabled={budgetBusy}>{budgetBusy ? <Loader2 className="size-3.5 animate-spin" /> : 'Salvar'}</button>
                              <button type="button" className="btn-ghost text-xs" onClick={() => setBudgetEditing(false)} disabled={budgetBusy}>Cancelar</button>
                            </div>
                          ) : (
                            <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={openBudgetEditor}>Ajustar orçamento</button>
                          )
                        ) : null}
                      </GlassCard>

                      <GlassCard className="p-4">
                        <div className="flex items-center gap-2">
                          {rejectedAds.length > 0 ? <AlertTriangle className="size-4 text-warning" /> : <CheckCircle2 className="size-4 text-success" />}
                          <h3 className="text-sm font-semibold text-foreground">Estrutura</h3>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          <div className="rounded-xl border border-border/50 bg-secondary/15 p-2.5"><p className="text-[10px] text-muted-foreground">Conjuntos</p><p className="mt-1 font-mono text-base font-semibold">{campaign.adSetCount ?? groups.length}</p></div>
                          <div className="rounded-xl border border-border/50 bg-secondary/15 p-2.5"><p className="text-[10px] text-muted-foreground">Anúncios ativos</p><p className="mt-1 font-mono text-base font-semibold">{activeAds}/{campaign.adCount ?? ads.length}</p></div>
                        </div>
                        {rejectedAds.length > 0 ? <p className="mt-3 text-[11px] text-warning">{rejectedAds.length} anúncio{rejectedAds.length === 1 ? '' : 's'} com reprovação ou alerta de revisão.</p> : <p className="mt-3 text-[11px] text-muted-foreground">Nenhuma reprovação detectada na estrutura carregada.</p>}
                        <button type="button" className="btn-ghost mt-3 w-full justify-center text-xs" onClick={() => setSection('structure')}>Abrir estrutura</button>
                      </GlassCard>
                    </div>
                  </div>
                </div>
              ) : null}

              {section === 'structure' ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Campanha → conjuntos → anúncios</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Entenda a estrutura sem voltar para a árvore principal. Edições do anúncio usam o mesmo fluxo já existente no produto.</p>
                  </div>
                  {groups.length === 0 ? (
                    <GlassCard className="p-8 text-center text-sm text-muted-foreground">Nenhum conjunto de anúncios carregado para esta campanha.</GlassCard>
                  ) : groups.map((group, groupIndex) => (
                    <GlassCard key={group.platformAdSetId || groupIndex} className="overflow-hidden p-0">
                      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 bg-secondary/15 px-4 py-3.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background/60 text-muted-foreground"><Layers className="size-4" /></span>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-foreground">{group.adSetName || group.name || `Conjunto ${groupIndex + 1}`}</p>
                            <p className="mt-0.5 font-mono text-[9px] text-muted-foreground">{group.platformAdSetId || 'ID não informado'}</p>
                          </div>
                          <StatusPill status={group.status} />
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Orçamento</p>
                          <p className="mt-0.5 font-mono text-xs font-semibold text-foreground">{group.budget?.amount != null ? fmtMoney(Number(group.budget.amount), ccy) : campaign.budgetOwner === 'campaign' ? 'Usa CBO' : '—'}</p>
                        </div>
                      </div>
                      <div className="grid gap-3 p-4 md:grid-cols-2">
                        {(group.ads ?? []).length === 0 ? <p className="col-span-full py-4 text-center text-xs text-muted-foreground">Nenhum anúncio neste conjunto.</p> : (group.ads ?? []).map((ad, adIndex) => {
                          const adId = ad.platformAdId || ad._id || String(adIndex)
                          return (
                            <div key={adId} className="rounded-2xl border border-border/55 bg-background/45 p-3.5">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex min-w-0 gap-2.5">
                                  <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-secondary/20 text-muted-foreground"><Clapperboard className="size-4" /></span>
                                  <div className="min-w-0">
                                    <p className="truncate text-xs font-semibold text-foreground">{ad.name || `Anúncio ${adIndex + 1}`}</p>
                                    <div className="mt-1 flex flex-wrap items-center gap-1.5"><StatusPill status={ad.status} />{ad.adType === 'boost' ? <span className="rounded-full border border-violet-500/20 bg-violet-500/10 px-2 py-0.5 text-[9px] text-violet-300">Spark</span> : null}</div>
                                  </div>
                                </div>
                                <button type="button" className="btn-ghost !p-2" onClick={() => setEditAd(ad)} title="Editar anúncio"><Pencil className="size-3.5" /></button>
                              </div>
                              {(ad.creative?.imageUrl || ad.creative?.videoUrl) ? (
                                <div className="mt-3 overflow-hidden rounded-xl border border-border/50 bg-black/50">
                                  {ad.creative?.imageUrl ? <img src={ad.creative.imageUrl} alt="" loading="lazy" className="aspect-video h-auto w-full object-cover" /> : <div className="flex aspect-video items-center justify-center text-[10px] text-muted-foreground">Criativo em vídeo</div>}
                                </div>
                              ) : null}
                              {ad.creative?.body ? <p className="mt-3 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">{ad.creative.body}</p> : null}
                              {ad.rejectionReason ? <div className="mt-3 rounded-xl border border-error/20 bg-error/8 p-2.5 text-[10px] text-error">{ad.rejectionReason}</div> : null}
                              <div className="mt-3 flex items-center justify-between gap-2 border-t border-border/40 pt-3">
                                <span className="font-mono text-[9px] text-muted-foreground">{adId}</span>
                                {ad.creative?.linkUrl ? <a href={ad.creative.linkUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] text-brand-cyan hover:underline">Destino <ExternalLink className="size-3" /></a> : null}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </GlassCard>
                  ))}
                </div>
              ) : null}

              {section === 'history' ? (
                <div className="flex flex-col gap-4">
                  <div>
                    <h3 className="text-base font-semibold text-foreground">Histórico operacional</h3>
                    <p className="mt-1 text-xs text-muted-foreground">Mudanças manuais, decisões da automação e eventos registrados para esta campanha.</p>
                  </div>
                  <GlassCard className="p-4 sm:p-5">
                    {auditError ? <p role="alert" className="text-xs text-warning">Não foi possível carregar o histórico.</p> : auditLoading ? <p className="text-xs text-muted-foreground">Carregando histórico…</p> : timeline.length ? (
                      <ol className="relative ml-2 border-l border-border pl-5">
                        {timeline.map((event) => (
                          <li key={event.id} className="relative pb-5 last:pb-0">
                            <span className="absolute -left-[1.52rem] top-1 flex size-3 items-center justify-center rounded-full border border-brand-cyan/30 bg-background"><span className="size-1.5 rounded-full bg-brand-cyan" /></span>
                            <div className="rounded-2xl border border-border/50 bg-secondary/10 p-3">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <p className="text-xs font-medium text-foreground">{event.reason || event.action.replace(/[._]/g, ' ')}</p>
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"><Clock3 className="size-3" />{new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }).format(new Date(event.created_at))}</span>
                              </div>
                              <p className="mt-1 font-mono text-[9px] text-muted-foreground">{event.action}</p>
                            </div>
                          </li>
                        ))}
                      </ol>
                    ) : <p className="text-xs text-muted-foreground">Ainda não há alterações registradas para esta campanha.</p>}
                  </GlassCard>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </DialogPortal>

      <AdEditDialog
        ad={editAd}
        adAccountId={advertiserId}
        onClose={() => setEditAd(null)}
        onSaved={() => { void refreshAfterMutation() }}
      />
    </>
  )
}
