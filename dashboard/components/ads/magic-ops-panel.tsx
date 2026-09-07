'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bot, Cloud, GripVertical, Loader2, RefreshCw, ShieldAlert, Sparkles, Wallet } from 'lucide-react'
import { apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'

const fetcher = async <T,>(url: string): Promise<T> => {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store' })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `Falha na API (${response.status})`)
  return body as T
}

type Profit = {
  currency: string; grossRevenueCents: number; adSpendCents: number; gatewayFeesCents: number
  taxesCents: number; productCostsCents: number; netProfitCents: number; netMarginPct: number
  quality: 'exact' | 'mixed'; note: string
}
type ProfitConfig = { gatewayFeePct: number; gatewayFixedFeeCents: number; taxPct: number; productCostPct: number; productCostFixedCents: number }
type Anomaly = { date: string; content: string; createdAt: string; meta?: { findings?: unknown[] } }
type CloudStatus = {
  providers: Record<'googleDrive' | 'dropbox', { configured: boolean; connected: boolean; enabled: boolean; folderId?: string; folderPath?: string }>
  activity: { provider: string; name: string; status: string; tiktok_video_id?: string; error?: string }[]
}
type QueueStatus = { paused: boolean; pausedUntil?: string | null; reason?: string; queued?: number; processing?: number }
type BotBlocks = { blocks: { ipHash: string; adKey?: string; count: number; expiresAt: number; active: boolean }[] }
type WidgetId = 'profit' | 'anomalies' | 'cloud' | 'protection'
const DEFAULT_WIDGETS: WidgetId[] = ['profit', 'anomalies', 'cloud', 'protection']

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format((Number(cents) || 0) / 100)
}

export function MagicOpsPanel({ active, advertiserId, currency, fromDate, toDate }: { active: boolean; advertiserId: string; currency: string; fromDate: string; toDate: string }) {
  const params = useMemo(() => new URLSearchParams({ adAccountId: advertiserId, currency, fromDate, toDate }).toString(), [advertiserId, currency, fromDate, toDate])
  const { data: profit, mutate: mutateProfit } = useSWR<Profit>(active && advertiserId ? `/api/ads/profitability?${params}` : null, fetcher, { refreshInterval: 60_000 })
  const { data: profitConfigData, mutate: mutateProfitConfig } = useSWR<{ config: ProfitConfig }>(active ? '/api/ads/profitability/config' : null, fetcher)
  const { data: anomalyData, mutate: mutateAnomalies } = useSWR<{ anomalies: Anomaly[] }>(active && advertiserId ? `/api/ads/anomalies?adAccountId=${encodeURIComponent(advertiserId)}` : null, fetcher, { refreshInterval: 60_000 })
  const { data: cloud, mutate: mutateCloud } = useSWR<CloudStatus>(active ? '/api/ads/cloud-video' : null, fetcher, { refreshInterval: 30_000 })
  const { data: queue } = useSWR<QueueStatus>(active ? '/api/ads/bulk/status' : null, fetcher, { refreshInterval: 10_000 })
  const { data: blocks, mutate: mutateBlocks } = useSWR<BotBlocks>(active ? '/api/cloak/blocks' : null, fetcher, { refreshInterval: 30_000 })
  const [runningAnomaly, setRunningAnomaly] = useState(false)
  const [profitDraft, setProfitDraft] = useState<ProfitConfig>({ gatewayFeePct: 0, gatewayFixedFeeCents: 0, taxPct: 0, productCostPct: 0, productCostFixedCents: 0 })
  const [syncingCloud, setSyncingCloud] = useState<string | null>(null)
  const [driveFolder, setDriveFolder] = useState('')
  const [dropboxFolder, setDropboxFolder] = useState('')
  const [dragging, setDragging] = useState<WidgetId | null>(null)
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_WIDGETS)
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('roi_ads_widget_order') || '[]') as WidgetId[]
      if (saved.length === DEFAULT_WIDGETS.length && DEFAULT_WIDGETS.every((id) => saved.includes(id))) setOrder(saved)
    } catch { /* preferência inválida volta ao padrão */ }
  }, [])
  useEffect(() => {
    if (!cloud) return
    setDriveFolder(cloud.providers.googleDrive.folderId || '')
    setDropboxFolder(cloud.providers.dropbox.folderPath || '')
  }, [cloud])
  useEffect(() => { if (profitConfigData?.config) setProfitDraft(profitConfigData.config) }, [profitConfigData])
  function moveWidget(target: WidgetId) {
    if (!dragging || dragging === target) return
    const next = order.filter((id) => id !== dragging)
    next.splice(next.indexOf(target), 0, dragging)
    setOrder(next)
    localStorage.setItem('roi_ads_widget_order', JSON.stringify(next))
    setDragging(null)
  }
  async function runAnomaly() {
    setRunningAnomaly(true)
    try {
      const result = await apiSend<{ findings?: unknown[] }>('/api/ads/anomalies/run', 'POST', { adAccountId: advertiserId, currency })
      toast.success(result.findings?.length ? 'Anomalia analisada' : 'Nenhuma anomalia relevante')
      await mutateAnomalies()
    } catch (error) { toast.error('Falha na análise', { hint: error instanceof Error ? error.message : undefined }) }
    finally { setRunningAnomaly(false) }
  }
  async function saveProfitConfig() {
    try {
      await apiSend('/api/ads/profitability/config', 'PUT', { config: profitDraft })
      await Promise.all([mutateProfitConfig(), mutateProfit()])
      toast.success('Custos do lucro atualizados')
    } catch (error) { toast.error('Falha ao salvar custos', { hint: error instanceof Error ? error.message : undefined }) }
  }
  async function connectCloud(provider: 'googleDrive' | 'dropbox') {
    try {
      const result = await apiSend<{ url: string }>(`/api/ads/cloud-video/${provider}/connect`, 'POST')
      window.location.href = result.url
    } catch (error) { toast.error('Conexão indisponível', { hint: error instanceof Error ? error.message : undefined }) }
  }
  async function syncCloud(provider: 'googleDrive' | 'dropbox') {
    setSyncingCloud(provider)
    try {
      await apiSend(`/api/ads/cloud-video/${provider}`, 'PUT', {
        enabled: true, advertiserId,
        ...(provider === 'googleDrive' ? { folderId: driveFolder.trim() } : { folderPath: dropboxFolder.trim() }),
      })
      const result = await apiSend<{ files?: { ok: boolean }[] }>(`/api/ads/cloud-video/${provider}/sync`, 'POST', { advertiserId })
      toast.success('Pasta sincronizada', { hint: `${result.files?.filter((file) => file.ok).length || 0} vídeo(s) enviado(s) ao TikTok.` })
      await mutateCloud()
    } catch (error) { toast.error('Falha na sincronização', { hint: error instanceof Error ? error.message : undefined }) }
    finally { setSyncingCloud(null) }
  }

  const latestAnomaly = anomalyData?.anomalies?.[0]
  const cards: Record<WidgetId, React.ReactNode> = {
    profit: (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><Wallet className="size-4 text-success" /><h3 className="text-sm font-semibold">Lucro líquido real</h3></div>
        {profit ? <>
          <p className={`font-mono text-2xl font-bold ${profit.netProfitCents >= 0 ? 'text-success' : 'text-error'}`}>{money(profit.netProfitCents, profit.currency)}</p>
          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
            <span>Receita <b className="block text-foreground">{money(profit.grossRevenueCents, profit.currency)}</b></span>
            <span>TikTok <b className="block text-foreground">-{money(profit.adSpendCents, profit.currency)}</b></span>
            <span>Taxas + impostos <b className="block text-foreground">-{money(profit.gatewayFeesCents + profit.taxesCents, profit.currency)}</b></span>
            <span>Margem <b className="block text-foreground">{profit.netMarginPct.toFixed(1)}%</b></span>
          </div>
          <p className={`text-[10px] ${profit.quality === 'exact' ? 'text-success' : 'text-warning'}`}>{profit.note}</p>
        </> : <Loader2 className="size-4 animate-spin text-muted" />}
        <button type="button" className="btn-ghost text-[10px]" onClick={() => void mutateProfit()}><RefreshCw className="size-3" /> Atualizar</button>
        <details className="rounded-lg border border-border/50 p-2 text-[10px] text-muted">
          <summary className="cursor-pointer font-medium text-foreground">Custos usados quando o gateway não informa</summary>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {([
              ['gatewayFeePct', 'Taxa gateway %'], ['taxPct', 'Impostos %'], ['productCostPct', 'Produto %'],
            ] as const).map(([key, label]) => <label key={key}>{label}<input type="number" min="0" max="100" step="0.01" className="input mt-1 w-full text-[10px]" value={profitDraft[key]} onChange={(event) => setProfitDraft((current) => ({ ...current, [key]: Number(event.target.value) }))} /></label>)}
            <label>Taxa fixa ({currency})<input type="number" min="0" step="0.01" className="input mt-1 w-full text-[10px]" value={profitDraft.gatewayFixedFeeCents / 100} onChange={(event) => setProfitDraft((current) => ({ ...current, gatewayFixedFeeCents: Math.round(Number(event.target.value) * 100) }))} /></label>
            <label>Custo fixo ({currency})<input type="number" min="0" step="0.01" className="input mt-1 w-full text-[10px]" value={profitDraft.productCostFixedCents / 100} onChange={(event) => setProfitDraft((current) => ({ ...current, productCostFixedCents: Math.round(Number(event.target.value) * 100) }))} /></label>
          </div>
          <button type="button" className="btn-ghost mt-2 text-[10px]" onClick={saveProfitConfig}>Salvar custos</button>
        </details>
      </div>
    ),
    anomalies: (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><Sparkles className="size-4 text-primary" /><h3 className="text-sm font-semibold">Detector a cada 4 horas</h3></div>
        <p className="min-h-12 text-xs leading-relaxed text-muted">{latestAnomaly?.content || 'O primeiro snapshot será comparado com a próxima janela. A IA só recebe anomalias já calculadas.'}</p>
        <button type="button" className="btn-ghost text-[10px]" onClick={runAnomaly} disabled={runningAnomaly}>{runningAnomaly ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Analisar agora</button>
      </div>
    ),
    cloud: (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><Cloud className="size-4 text-info" /><h3 className="text-sm font-semibold">Drive → rascunho TikTok</h3></div>
        {(['googleDrive', 'dropbox'] as const).map((provider) => {
          const item = cloud?.providers?.[provider]
          const label = provider === 'googleDrive' ? 'Google Drive' : 'Dropbox'
          return <div key={provider} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 p-2 text-[11px]"><span>{label}<small className={`ml-2 ${item?.connected ? 'text-success' : 'text-muted'}`}>{item?.connected ? 'conectado' : item?.configured ? 'pronto' : 'configure OAuth'}</small></span>{item?.connected ? <button type="button" className="btn-ghost text-[10px]" onClick={() => void syncCloud(provider)} disabled={syncingCloud === provider}>{syncingCloud === provider ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Sincronizar</button> : <button type="button" className="btn-ghost text-[10px]" onClick={() => void connectCloud(provider)} disabled={!item?.configured}>Conectar</button>}</div>
        })}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[10px] text-faint">ID da pasta no Google Drive<input className="input mt-1 w-full text-[10px]" value={driveFolder} onChange={(event) => setDriveFolder(event.target.value)} placeholder="vazio = todos os vídeos" /></label>
          <label className="text-[10px] text-faint">Caminho no Dropbox<input className="input mt-1 w-full text-[10px]" value={dropboxFolder} onChange={(event) => setDropboxFolder(event.target.value)} placeholder="/Criativos" /></label>
        </div>
        <p className="text-[10px] text-faint">Novos arquivos são enviados como assets reutilizáveis; nenhuma campanha é ativada.</p>
      </div>
    ),
    protection: (
      <div className="space-y-3">
        <div className="flex items-center gap-2"><ShieldAlert className="size-4 text-warning" /><h3 className="text-sm font-semibold">Proteção e filas</h3></div>
        <div className="grid grid-cols-2 gap-2 text-[10px] text-muted">
          <span>IPs bloqueados <b className="block text-foreground">{blocks?.blocks?.length || 0}</b></span>
          <span>Fila de edições <b className={`block ${queue?.paused ? 'text-warning' : 'text-success'}`}>{queue?.paused ? 'pausada 5 min' : 'operando'}</b></span>
        </div>
        {queue?.paused && <p className="text-[10px] text-warning">Rate limit detectado. Retomada automática {queue.pausedUntil ? new Date(queue.pausedUntil).toLocaleTimeString('pt-BR') : 'em breve'}.</p>}
        {(blocks?.blocks || []).filter((block) => block.active).slice(0, 2).map((block) => <div key={block.ipHash} className="flex items-center justify-between text-[10px]"><span className="font-mono text-faint">{block.ipHash.slice(0, 12)}… · {block.count} sinais</span><button type="button" className="text-error" onClick={async () => { await apiSend(`/api/cloak/blocks/${encodeURIComponent(block.ipHash)}`, 'DELETE'); await mutateBlocks() }}>desbloquear</button></div>)}
      </div>
    ),
  }

  return (
    <section className="space-y-2" aria-label="Central personalizável">
      <div className="flex items-center justify-between"><div><h2 className="flex items-center gap-2 text-sm font-semibold"><Bot className="size-4 text-primary" /> Central mágica</h2><p className="text-[10px] text-muted">Arraste os módulos para montar sua central.</p></div></div>
      <div className="grid gap-3 lg:grid-cols-2">
        {order.map((id) => <GlassCard key={id} draggable onDragStart={() => setDragging(id)} onDragOver={(event) => event.preventDefault()} onDrop={() => moveWidget(id)} onDragEnd={() => setDragging(null)} className={`relative min-h-48 p-4 ${dragging === id ? 'opacity-50' : ''}`}><GripVertical className="absolute right-3 top-3 size-4 cursor-grab text-muted-foreground" aria-label="Arraste para reorganizar" />{cards[id]}</GlassCard>)}
      </div>
    </section>
  )
}
