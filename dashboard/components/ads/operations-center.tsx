'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, Clock3, Download, FileText, Heart, Search, Settings2, Target, X } from 'lucide-react'
import { apiSend, useAdsAudit, useAdsReports, useAdsWorkspace } from '@/lib/api'
import type { AdsTreeCampaign, AdsWorkspace } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { fmtSpend } from '@/lib/format'

function scoreAnomalies(campaigns: AdsTreeCampaign[]) {
  return campaigns.flatMap((campaign) => {
    const m = campaign.metrics || {}
    const findings: { id: string; title: string; evidence: string; severity: 'warning' | 'error' }[] = []
    const spend = m.spend || 0
    const conversions = m.conversions || 0
    const ctr = m.impressions ? ((m.clicks || 0) / m.impressions) * 100 : 0
    if (spend >= 25 && conversions === 0) findings.push({ id: `${campaign.platformCampaignId}-spend`, title: 'Gasto sem conversões', evidence: `${campaign.campaignName || campaign.platformCampaignId}: ${spend.toFixed(2)} investidos e nenhuma conversão.`, severity: 'error' })
    if ((m.impressions || 0) >= 1000 && ctr < 0.5) findings.push({ id: `${campaign.platformCampaignId}-ctr`, title: 'CTR abaixo de 0,5%', evidence: `${campaign.campaignName || campaign.platformCampaignId}: CTR de ${ctr.toFixed(2)}% em ${m.impressions} impressões.`, severity: 'warning' })
    return findings
  }).slice(0, 6)
}

export function OperationsCenter({
  active,
  advertiserId,
  currency,
  campaigns,
  conversions,
  revenue,
  onNavigate,
}: {
  active: boolean
  advertiserId: string
  currency: string
  campaigns: AdsTreeCampaign[]
  conversions: number
  revenue: number
  onNavigate: (tab: 'campaigns' | 'catalog' | 'automation' | 'ai', id?: string) => void
}) {
  const { data, mutate } = useAdsWorkspace(active, advertiserId)
  const { data: audit } = useAdsAudit(active)
  const { data: reports, mutate: mutateReports } = useAdsReports(active, advertiserId)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<AdsWorkspace | null>(null)
  const workspace = data?.workspace
  const goals = workspace?.goals
  const anomalies = useMemo(() => scoreAnomalies(campaigns), [campaigns])
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('pt')
    if (q.length < 2) return []
    return campaigns.filter((item) => `${item.campaignName || ''} ${item.platformCampaignId}`.toLocaleLowerCase('pt').includes(q)).slice(0, 8)
  }, [campaigns, query])

  async function save(next: AdsWorkspace) {
    setSaving(true)
    try {
      await apiSend('/api/ads/workspace', 'PUT', { advertiserId, workspace: next })
      await mutate()
      setEditing(false)
      toast.success('Preferências operacionais salvas')
    } catch (error) {
      toast.error('Não foi possível salvar', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  async function createReport(kind: 'daily' | 'weekly' | 'monthly') {
    try {
      const spend = campaigns.reduce((sum, item) => sum + (item.metrics?.spend || 0), 0)
      await apiSend('/api/ads/reports', 'POST', {
        advertiserId,
        kind,
        title: `Relatório ${kind === 'daily' ? 'diário' : kind === 'weekly' ? 'semanal' : 'mensal'}`,
        content: { advertiserId, generatedAt: new Date().toISOString(), spend, conversions, revenue, campaignCount: campaigns.length, anomalies },
      })
      await mutateReports()
      toast.success('Relatório salvo na dashboard')
    } catch (error) {
      toast.error('Falha ao gerar relatório', { hint: error instanceof Error ? error.message : undefined })
    }
  }

  const spend = campaigns.reduce((sum, item) => sum + (item.metrics?.spend || 0), 0)
  const roas = spend > 0 ? revenue / spend : null
  const cpa = conversions > 0 ? spend / conversions : null

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="relative p-4">
        <label className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2.5 focus-within:ring-2 focus-within:ring-ring">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Buscar em TikTok Ads</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar campanha por nome ou ID" className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Limpar busca"><X className="size-4 text-muted-foreground" /></button>}
        </label>
        {query.trim().length >= 2 && (
          <div className="absolute inset-x-4 top-16 z-20 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
            {results.length ? results.map((item) => (
              <button key={item.platformCampaignId} type="button" onClick={() => { onNavigate('campaigns', item.platformCampaignId); setQuery('') }} className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left last:border-0 hover:bg-secondary">
                <span className="truncate text-sm font-medium text-foreground">{item.campaignName || 'Campanha sem nome'}</span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{item.platformCampaignId}</span>
              </button>
            )) : <p className="p-3 text-xs text-muted-foreground">Nenhuma campanha encontrada neste período.</p>}
          </div>
        )}
      </GlassCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2"><Target className="size-4 text-brand-cyan" /><h3 className="text-sm font-semibold text-foreground">Metas da operação</h3></div>
            <button type="button" className="btn-ghost px-2 py-1 text-[11px]" onClick={() => { setDraft(workspace || null); setEditing(true) }}><Settings2 className="size-3" /> Configurar</button>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[['ROAS', roas, goals?.roasMin, false], ['CPA', cpa, goals?.cpaMax, true], ['Conversões', conversions, goals?.conversionsTarget, false], ['Receita', revenue, goals?.revenueTarget, false]].map(([label, value, target, lower]) => {
              const n = typeof value === 'number' ? value : null
              const t = Number(target) || 0
              const met = t > 0 && n !== null ? (lower ? n <= t : n >= t) : null
              return <div key={String(label)} className="rounded-xl border border-border bg-background/50 p-3"><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p><div className="mt-1 flex items-end justify-between gap-2"><span className="font-mono text-lg font-bold text-foreground">{n === null ? 'N/A' : label === 'CPA' || label === 'Receita' ? fmtSpend(n, currency) : n.toFixed(label === 'ROAS' ? 2 : 0)}</span>{met !== null && <span className={`text-[10px] font-bold ${met ? 'text-success' : 'text-warning'}`}>{met ? 'Na meta' : 'Fora da meta'}</span>}</div></div>
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center gap-2"><AlertTriangle className="size-4 text-warning" /><h3 className="text-sm font-semibold text-foreground">Anomalias explicáveis</h3></div>
          <div className="mt-3 flex flex-col gap-2">
            {anomalies.length ? anomalies.map((item) => <button key={item.id} type="button" onClick={() => onNavigate('campaigns', item.id.split('-')[0])} className="rounded-xl border border-border bg-background/50 p-3 text-left hover:bg-secondary"><div className="flex items-center justify-between gap-2"><span className="text-xs font-semibold text-foreground">{item.title}</span><span className={`size-2 rounded-full ${item.severity === 'error' ? 'bg-error' : 'bg-warning'}`} /></div><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{item.evidence}</p></button>) : <p className="rounded-xl border border-border bg-background/50 p-3 text-xs text-muted-foreground">Nenhuma anomalia determinística com dados suficientes.</p>}
          </div>
        </GlassCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-4">
          <div className="flex items-center gap-2"><Clock3 className="size-4 text-brand-cyan" /><h3 className="text-sm font-semibold text-foreground">Timeline operacional</h3></div>
          <div className="mt-3 flex max-h-64 flex-col gap-3 overflow-y-auto">
            {(audit?.events || []).filter((event) => !event.advertiser_id || event.advertiser_id === advertiserId).slice(0, 12).map((event) => <div key={event.id} className="border-l-2 border-border pl-3"><p className="text-xs font-medium text-foreground">{event.reason || event.action}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{new Date(event.created_at).toLocaleString('pt-BR')} · {event.target_type || 'operação'}</p></div>)}
            {!audit?.events?.length && <p className="text-xs text-muted-foreground">Nenhuma operação registrada ainda.</p>}
          </div>
        </GlassCard>

        <GlassCard className="p-4">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><FileText className="size-4 text-brand-cyan" /><h3 className="text-sm font-semibold text-foreground">Relatórios internos</h3></div><div className="flex gap-1"><button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={() => createReport('daily')}>Diário</button><button type="button" className="btn-ghost px-2 py-1 text-[10px]" onClick={() => createReport('weekly')}>Semanal</button></div></div>
          <div className="mt-3 flex flex-col gap-2">
            {(reports?.reports || []).slice(0, 5).map((report) => <div key={report.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-background/50 p-3"><div className="min-w-0"><p className="truncate text-xs font-medium text-foreground">{report.title}</p><p className="text-[10px] text-muted-foreground">{new Date(report.created_at).toLocaleString('pt-BR')}</p></div><button type="button" aria-label="Baixar relatório" onClick={() => { const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${report.id}.json`; a.click(); URL.revokeObjectURL(url) }}><Download className="size-4 text-muted-foreground" /></button></div>)}
            {!reports?.reports?.length && <p className="text-xs text-muted-foreground">Gere um relatório sob demanda. Ele ficará somente na dashboard.</p>}
          </div>
        </GlassCard>
      </div>

      {workspace?.favorites.length ? <GlassCard className="p-4"><div className="flex items-center gap-2"><Heart className="size-4 text-error" /><h3 className="text-sm font-semibold text-foreground">Favoritos</h3></div><div className="mt-3 flex flex-wrap gap-2">{workspace.favorites.map((item) => <button key={`${item.type}:${item.id}`} type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => onNavigate(item.type === 'rule' ? 'automation' : item.type === 'product' ? 'catalog' : 'campaigns', item.id)}>{item.label}</button>)}</div></GlassCard> : null}

      {editing && draft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4"><GlassCard className="w-full max-w-lg p-5"><div className="flex items-center justify-between"><h2 className="text-base font-semibold text-foreground">Metas e governança</h2><button type="button" onClick={() => setEditing(false)} aria-label="Fechar"><X className="size-5" /></button></div><div className="mt-4 grid grid-cols-2 gap-3">{([['roasMin','ROAS mínimo'],['cpaMax','CPA máximo'],['dailySpendCap','Limite diário'],['conversionsTarget','Meta de conversões'],['revenueTarget','Meta de receita']] as const).map(([key,label]) => <label key={key} className="flex flex-col gap-1 text-xs text-muted-foreground">{label}<input type="number" min="0" step="0.01" value={draft.goals[key]} onChange={(e) => setDraft({ ...draft, goals: { ...draft.goals, [key]: Number(e.target.value) } })} className="input-neon rounded-lg border border-border bg-background px-3 py-2 text-foreground" /></label>)}</div><div className="mt-4 rounded-xl border border-border bg-background/50 p-3"><p className="text-xs font-semibold text-foreground">Aprovação dupla preparada</p><p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Permanece desativada até existir gestão real de usuários. Papel atual: administrador. Limite de alvos por ação: {draft.governance.maxTargetsPerAction}.</p></div><div className="mt-4 flex justify-end gap-2"><button type="button" className="btn-ghost" onClick={() => setEditing(false)}>Cancelar</button><button type="button" className="btn-primary" disabled={saving} onClick={() => save(draft)}>{saving ? 'Salvando...' : 'Salvar'}</button></div></GlassCard></div>}
    </div>
  )
}
