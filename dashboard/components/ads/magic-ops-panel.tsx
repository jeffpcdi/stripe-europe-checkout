'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { GripVertical, Loader2, RefreshCw } from 'lucide-react'
import { apiSend, fetcher } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

type Profit = {
  currency: string
  grossRevenueCents: number
  adSpendCents: number
  gatewayFeesCents: number
  taxesCents: number
  productCostsCents: number
  netProfitCents: number
  netMarginPct: number
  quality: 'exact' | 'mixed'
  note: string
  fixedCostCurrency?: string
  fixedCostsApplied?: boolean
  fixedCostCurrencyMismatch?: boolean
  timeZone?: string
  spendTimeZone?: string
  calendarSource?: 'advertiser' | 'advertiser_context' | 'account_fallback' | 'account'
}
type ProfitConfig = {
  gatewayFeePct: number
  gatewayFixedFeeCents: number
  taxPct: number
  productCostPct: number
  productCostFixedCents: number
  fixedCostCurrency: string
  gatewayOverrides?: Record<string, { feePct?: number; fixedFeeCents?: number }>
}
type Anomaly = { date: string; content: string; createdAt: string; meta?: { findings?: unknown[] } }
type CloudStatus = {
  providers: Record<'googleDrive' | 'dropbox', { configured: boolean; connected: boolean; enabled: boolean; folderId?: string; folderPath?: string }>
  activity: { provider: string; name: string; status: string; tiktok_video_id?: string; error?: string }[]
}
type QueueStatus = { paused: boolean; pausedUntil?: string | null; reason?: string; queued?: number; processing?: number }
type WidgetId = 'profit' | 'anomalies' | 'cloud' | 'protection'
type CloudProvider = 'googleDrive' | 'dropbox'

const DEFAULT_WIDGETS: WidgetId[] = ['profit', 'anomalies', 'cloud', 'protection']
const COST_CURRENCIES = ['BRL', 'USD', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']
const EMPTY_PROFIT: ProfitConfig = {
  gatewayFeePct: 0,
  gatewayFixedFeeCents: 0,
  taxPct: 0,
  productCostPct: 0,
  productCostFixedCents: 0,
  fixedCostCurrency: 'BRL',
  gatewayOverrides: {},
}

function money(cents: number, currency: string) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format((Number(cents) || 0) / 100)
}
function timeOnly(value?: string | null) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function normalizeProfitConfig(value?: Partial<ProfitConfig> | null): ProfitConfig {
  const currency = String(value?.fixedCostCurrency || 'BRL').toUpperCase()
  return {
    gatewayFeePct: Number(value?.gatewayFeePct) || 0,
    gatewayFixedFeeCents: Math.max(0, Math.round(Number(value?.gatewayFixedFeeCents) || 0)),
    taxPct: Number(value?.taxPct) || 0,
    productCostPct: Number(value?.productCostPct) || 0,
    productCostFixedCents: Math.max(0, Math.round(Number(value?.productCostFixedCents) || 0)),
    fixedCostCurrency: /^[A-Z]{3}$/.test(currency) ? currency : 'BRL',
    gatewayOverrides: value?.gatewayOverrides || {},
  }
}
function sameProfitConfig(a: ProfitConfig, b: ProfitConfig) {
  return JSON.stringify(normalizeProfitConfig(a)) === JSON.stringify(normalizeProfitConfig(b))
}

export function MagicOpsPanel({
  active,
  advertiserId,
  currency,
  fromDate,
  toDate,
  advertiserTimeZone,
  onDirtyChange,
  externalDirty = false,
}: {
  active: boolean
  advertiserId: string
  currency: string
  fromDate: string
  toDate: string
  advertiserTimeZone: string
  onDirtyChange?: (dirty: boolean) => void
  externalDirty?: boolean
}) {
  const params = useMemo(() => new URLSearchParams({ adAccountId: advertiserId, currency, fromDate, toDate, calendar: 'advertiser', calendarTimeZone: advertiserTimeZone }).toString(), [advertiserId, advertiserTimeZone, currency, fromDate, toDate])
  const { data: profit, error: profitError, mutate: mutateProfit } = useSWR<Profit>(active && advertiserId ? `/api/ads/profitability?${params}` : null, fetcher, { refreshInterval: 60_000 })
  const { data: profitConfigData, error: profitConfigDataError, mutate: mutateProfitConfig } = useSWR<{ config: ProfitConfig }>(active ? '/api/ads/profitability/config' : null, fetcher)
  const { data: anomalyData, error: anomalyDataError, mutate: mutateAnomalies } = useSWR<{ anomalies: Anomaly[] }>(active && advertiserId ? `/api/ads/anomalies?adAccountId=${encodeURIComponent(advertiserId)}` : null, fetcher, { refreshInterval: 60_000 })
  const { data: cloud, error: cloudError, mutate: mutateCloud } = useSWR<CloudStatus>(active ? '/api/ads/cloud-video' : null, fetcher, { refreshInterval: 30_000 })
  const { data: queue, error: queueError, mutate: mutateQueue } = useSWR<QueueStatus>(active ? '/api/ads/bulk/status' : null, fetcher, { refreshInterval: 10_000 })

  const [savingProfit, setSavingProfit] = useState(false)
  const [confirmCloudConnect, setConfirmCloudConnect] = useState<CloudProvider | null>(null)
  const [runningAnomaly, setRunningAnomaly] = useState(false)
  const [profitDraft, setProfitDraft] = useState<ProfitConfig>(EMPTY_PROFIT)
  const [profitBaseline, setProfitBaseline] = useState<ProfitConfig>(EMPTY_PROFIT)
  const [syncingCloud, setSyncingCloud] = useState<string | null>(null)
  const syncingCloudRef = useRef<string | null>(null)
  const [savingCloud, setSavingCloud] = useState<string | null>(null)
  const [driveFolder, setDriveFolder] = useState('')
  const [dropboxFolder, setDropboxFolder] = useState('')
  const [cloudBaseline, setCloudBaseline] = useState({ googleDrive: '', dropbox: '' })
  const [organizing, setOrganizing] = useState(false)
  const [dragging, setDragging] = useState<WidgetId | null>(null)
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_WIDGETS)

  const profitDirty = useMemo(() => !sameProfitConfig(profitDraft, profitBaseline), [profitDraft, profitBaseline])
  const cloudDirty = useMemo(() => ({
    googleDrive: driveFolder.trim() !== cloudBaseline.googleDrive,
    dropbox: dropboxFolder.trim() !== cloudBaseline.dropbox,
  }), [cloudBaseline.dropbox, cloudBaseline.googleDrive, driveFolder, dropboxFolder])
  const localDirty = profitDirty || cloudDirty.googleDrive || cloudDirty.dropbox

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('roi_ads_widget_order') || '[]') as WidgetId[]
      if (Array.isArray(saved) && saved.length === DEFAULT_WIDGETS.length && DEFAULT_WIDGETS.every((id) => saved.includes(id))) setOrder(saved)
    } catch {}
  }, [])

  useEffect(() => {
    if (!cloud) return
    const next = {
      googleDrive: cloud.providers?.googleDrive?.folderId || '',
      dropbox: cloud.providers?.dropbox?.folderPath || '',
    }
    setDriveFolder((current) => current.trim() === cloudBaseline.googleDrive ? next.googleDrive : current)
    setDropboxFolder((current) => current.trim() === cloudBaseline.dropbox ? next.dropbox : current)
    setCloudBaseline(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloud])

  useEffect(() => {
    if (!profitConfigData?.config) return
    const next = normalizeProfitConfig(profitConfigData.config)
    setProfitDraft((current) => sameProfitConfig(current, profitBaseline) ? next : current)
    setProfitBaseline(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profitConfigData])

  useEffect(() => { onDirtyChange?.(localDirty) }, [localDirty, onDirtyChange])

  function moveWidget(target: WidgetId) {
    if (!organizing || !dragging || dragging === target) return
    const next = order.filter((id) => id !== dragging)
    next.splice(next.indexOf(target), 0, dragging)
    setOrder(next)
    try { localStorage.setItem('roi_ads_widget_order', JSON.stringify(next)) } catch {}
    setDragging(null)
  }

  async function runAnomaly() {
    setRunningAnomaly(true)
    try {
      const result = await apiSend<{ findings?: unknown[] }>('/api/ads/anomalies/run', 'POST', { adAccountId: advertiserId, currency })
      toast.success(result.findings?.length ? 'Análise concluída' : 'Nenhuma anomalia relevante')
      await mutateAnomalies()
    } catch (e) {
      toast.error('Falha na análise', { hint: e instanceof Error ? e.message : undefined })
    } finally { setRunningAnomaly(false) }
  }

  async function saveProfitConfig() {
    if (savingProfit || !profitDirty) return
    const numeric = [profitDraft.gatewayFeePct, profitDraft.gatewayFixedFeeCents, profitDraft.taxPct, profitDraft.productCostPct, profitDraft.productCostFixedCents]
    const invalid = numeric.some((v) => !Number.isFinite(v) || v < 0)
      || [profitDraft.gatewayFeePct, profitDraft.taxPct, profitDraft.productCostPct].some((v) => v > 100)
      || !/^[A-Z]{3}$/.test(profitDraft.fixedCostCurrency)
    if (invalid) return toast.error('Revise os custos: use valores positivos, percentuais até 100% e uma moeda válida.')
    setSavingProfit(true)
    try {
      const next = normalizeProfitConfig(profitDraft)
      await apiSend('/api/ads/profitability/config', 'PUT', { config: next })
      setProfitBaseline(next)
      setProfitDraft(next)
      await Promise.all([mutateProfitConfig(), mutateProfit()])
      toast.success('Custos atualizados')
    } catch (e) {
      toast.error('Falha ao salvar custos', { hint: e instanceof Error ? e.message : undefined })
    } finally { setSavingProfit(false) }
  }

  async function performCloudConnect(provider: CloudProvider) {
    try {
      const result = await apiSend<{ url: string }>(`/api/ads/cloud-video/${provider}/connect`, 'POST')
      window.location.href = result.url
    } catch (e) {
      toast.error('Conexão indisponível', { hint: e instanceof Error ? e.message : undefined })
    } finally { setConfirmCloudConnect(null) }
  }

  function connectCloud(provider: CloudProvider) {
    if (localDirty || externalDirty) {
      setConfirmCloudConnect(provider)
      return
    }
    void performCloudConnect(provider)
  }

  async function saveCloud(provider: CloudProvider) {
    setSavingCloud(provider)
    const nextValue = provider === 'googleDrive' ? driveFolder.trim() : dropboxFolder.trim()
    try {
      await apiSend(`/api/ads/cloud-video/${provider}`, 'PUT', {
        enabled: true,
        advertiserId,
        ...(provider === 'googleDrive' ? { folderId: nextValue } : { folderPath: nextValue }),
      })
      setCloudBaseline((current) => ({ ...current, [provider]: nextValue }))
      await mutateCloud()
      toast.success('Origem salva')
      return true
    } catch (e) {
      toast.error('Falha ao salvar origem', { hint: e instanceof Error ? e.message : undefined })
      return false
    } finally { setSavingCloud(null) }
  }

  async function syncCloud(provider: CloudProvider) {
    if (syncingCloudRef.current) return
    syncingCloudRef.current = provider
    setSyncingCloud(provider)
    try {
      if (cloudDirty[provider] && !(await saveCloud(provider))) return
      const result = await apiSend<{ skipped?: boolean; reason?: string; files?: { ok: boolean }[] }>(`/api/ads/cloud-video/${provider}/sync`, 'POST', { advertiserId })
      const uploaded = result.files?.filter((f) => f.ok).length || 0
      const failed = result.files?.filter((f) => !f.ok).length || 0
      if (result.skipped) {
        if (result.reason === 'already_running') toast.info('Já existe uma sincronização em andamento')
        else toast.info('Sincronização não iniciada. Confira a conexão e a pasta.')
      }
      else if (failed) toast.error('Alguns vídeos não foram enviados', { hint: `${uploaded} enviados · ${failed} com falha.` })
      else toast.success(uploaded ? `${uploaded} vídeo(s) enviado(s)` : 'Nenhum vídeo novo para enviar')
      await mutateCloud()
    } catch (e) {
      toast.error('Falha na sincronização', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      syncingCloudRef.current = null
      setSyncingCloud(null)
    }
  }

  const loadFailed = profitError || profitConfigDataError || anomalyDataError || cloudError || queueError
  const latestAnomaly = anomalyData?.anomalies?.[0]
  const queueResumeTime = timeOnly(queue?.pausedUntil)
  const fixedCurrencies = COST_CURRENCIES.includes(profitDraft.fixedCostCurrency)
    ? COST_CURRENCIES
    : [profitDraft.fixedCostCurrency, ...COST_CURRENCIES]

  const sections: Record<WidgetId, React.ReactNode> = {
    profit: (
      <div className="py-4">
        <div className="flex items-start justify-between gap-3">
          <div><h3 className="text-sm font-semibold text-foreground">Resultado após custos</h3><p className="mt-1 text-xs text-muted-foreground">Receita menos TikTok, taxas, impostos e produto.</p></div>
          <button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => void mutateProfit()}><RefreshCw className="size-3.5" />Atualizar</button>
        </div>
        {profit ? <>
          <p className={`mt-3 text-2xl font-semibold ${profit.netProfitCents >= 0 ? 'text-success' : 'text-error'}`}>{money(profit.netProfitCents, profit.currency)}</p>
          {profit.timeZone ? (profit.calendarSource === 'account_fallback' ? <p className="mt-1 text-xs text-warning">Fuso TikTok indisponível · período calculado em {profit.timeZone}. <span className="text-muted-foreground">Atualize novamente para usar o calendário da conta de anúncios.</span></p> : <p className="mt-1 text-xs text-muted-foreground">Período no fuso da conta TikTok · {profit.timeZone}</p>) : null}
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-5">
            <span>Receita <b className="block text-foreground">{money(profit.grossRevenueCents, profit.currency)}</b></span>
            <span>TikTok <b className="block text-foreground">-{money(profit.adSpendCents, profit.currency)}</b></span>
            <span>Taxas + impostos <b className="block text-foreground">-{money(profit.gatewayFeesCents + profit.taxesCents, profit.currency)}</b></span>
            <span>Produtos <b className="block text-foreground">-{money(profit.productCostsCents, profit.currency)}</b></span>
            <span>Margem <b className="block text-foreground">{profit.netMarginPct.toFixed(1)}%</b></span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">{profit.quality === 'exact' ? 'Dados completos.' : 'Parte dos custos foi estimada.'} {profit.note}</p>
          {profit.fixedCostCurrencyMismatch ? <p className="mt-2 border-l-2 border-warning pl-3 text-xs leading-relaxed text-warning">Custos fixos em {profit.fixedCostCurrency || profitDraft.fixedCostCurrency} não foram aplicados ao resultado em {profit.currency}. Percentuais continuam sendo considerados. O ROI-NADOS não faz conversão cambial automática.</p> : null}
        </> : profitError ? <p className="mt-3 text-xs text-warning">Resultado indisponível.</p> : <Loader2 className="mt-3 size-4 animate-spin text-muted" />}
        <details className="mt-4 border-t border-border/60 pt-3">
          <summary className="cursor-pointer text-xs font-medium text-foreground">Custos usados quando o gateway não informa</summary>
          <p className="mt-2 text-xs text-muted-foreground">Estes valores são usados apenas como fallback quando o dado real não está disponível. Estes custos padrão se aplicam à conta ROI-NADOS, não apenas à conta TikTok selecionada.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {([['gatewayFeePct','Taxa gateway %'],['taxPct','Impostos %'],['productCostPct','Produto %']] as const).map(([key,label]) => <label key={key} className="text-xs text-muted-foreground">{label}<input type="number" min="0" max="100" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-cyan/60" value={profitDraft[key]} onChange={(e) => setProfitDraft((c) => ({ ...c, [key]: Number(e.target.value) }))} /></label>)}
            <label className="text-xs text-muted-foreground">Moeda dos custos fixos<select className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus:border-brand-cyan/60" value={profitDraft.fixedCostCurrency} onChange={(e) => setProfitDraft((c) => ({ ...c, fixedCostCurrency: e.target.value }))}>{fixedCurrencies.map(code => <option key={code} value={code}>{code}</option>)}</select></label>
            <label className="text-xs text-muted-foreground">Taxa fixa ({profitDraft.fixedCostCurrency})<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-cyan/60" value={profitDraft.gatewayFixedFeeCents / 100} onChange={(e) => setProfitDraft((c) => ({ ...c, gatewayFixedFeeCents: Math.round(Number(e.target.value) * 100) }))} /></label>
            <label className="text-xs text-muted-foreground">Custo fixo ({profitDraft.fixedCostCurrency})<input type="number" min="0" step="0.01" className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-cyan/60" value={profitDraft.productCostFixedCents / 100} onChange={(e) => setProfitDraft((c) => ({ ...c, productCostFixedCents: Math.round(Number(e.target.value) * 100) }))} /></label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Taxas e custos fixos são interpretados nesta moeda. Percentuais continuam válidos em qualquer moeda.</p>
          {profitDirty ? <p className="mt-2 text-xs text-warning">Alterações não salvas</p> : null}
          <button type="button" className="btn-primary mt-3 min-h-10 text-xs" onClick={saveProfitConfig} disabled={savingProfit || !profitDirty || !profitConfigData || !!profitConfigDataError}>{savingProfit ? <Loader2 className="size-3.5 animate-spin" /> : null}Salvar custos</button>
        </details>
      </div>
    ),
    anomalies: <div className="py-4"><h3 className="text-sm font-semibold text-foreground">Análise de desempenho</h3><p className="mt-1 text-xs text-muted-foreground">Analisa os dados e destaca mudanças relevantes. Não altera campanhas.</p><p className="mt-3 text-xs leading-relaxed text-muted-foreground">{latestAnomaly?.content || 'As próximas leituras serão comparadas para identificar mudanças no desempenho.'}</p><button type="button" className="btn-ghost mt-3 min-h-10 text-xs" onClick={runAnomaly} disabled={runningAnomaly}>{runningAnomaly ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Analisar agora</button></div>,
    cloud: <div className="py-4"><h3 className="text-sm font-semibold text-foreground">Vídeos da nuvem</h3><p className="mt-1 text-xs text-muted-foreground">Salve a origem separadamente e sincronize apenas quando quiser importar novos vídeos.</p><div className="mt-3 divide-y divide-border/60 border-y border-border/60">{(['googleDrive','dropbox'] as const).map((provider) => { const item = cloud?.providers?.[provider]; const label = provider === 'googleDrive' ? 'Google Drive' : 'Dropbox'; const value = provider === 'googleDrive' ? driveFolder : dropboxFolder; return <div key={provider} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium text-foreground">{label} <span className="ml-2 text-xs text-muted-foreground">{item?.connected ? '● Conectado' : item?.configured ? '● Configuração pronta' : '● Configuração pendente'}</span></p>{item?.connected ? <button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => void syncCloud(provider)} disabled={syncingCloud !== null}>{syncingCloud === provider ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}Sincronizar agora</button> : <button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => connectCloud(provider)} disabled={!item?.configured}>Conectar</button>}</div>{!item?.configured ? <p className="mt-2 text-xs text-muted-foreground">Conexão ainda não configurada no servidor.</p> : null}<label className="mt-3 block text-xs text-muted-foreground">{provider === 'googleDrive' ? 'Pasta de origem' : 'Caminho da pasta'}<input className="mt-1 h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand-cyan/60" value={value} onChange={(e) => provider === 'googleDrive' ? setDriveFolder(e.target.value) : setDropboxFolder(e.target.value)} placeholder={provider === 'googleDrive' ? 'Vazio = todos os vídeos disponíveis' : '/Criativos'} /></label>{cloudDirty[provider] ? <p className="mt-2 text-xs text-warning">Alterações não salvas</p> : null}<button type="button" className="btn-secondary mt-2 min-h-10 text-xs" onClick={() => void saveCloud(provider)} disabled={savingCloud !== null || !cloudDirty[provider]}>{savingCloud === provider ? <Loader2 className="size-3.5 animate-spin" /> : null}Salvar origem</button></div>})}</div></div>,
    protection: <div className="py-4"><h3 className="text-sm font-semibold text-foreground">Fila operacional</h3><p className="mt-1 text-xs text-muted-foreground">Estado das alterações enviadas pelo ROI-NADOS para o TikTok.</p><div className="mt-3"><p className="text-xs text-muted-foreground">Fila de alterações TikTok</p><p className={`mt-1 text-sm font-medium ${queue?.paused ? 'text-warning' : 'text-success'}`}>{!queue || queueError ? 'Estado não disponível' : queue.paused ? '● Pausada temporariamente' : '● Operando'}</p>{queue?.paused ? <p className="mt-1 text-xs text-warning">{queueResumeTime ? `Retomada automática às ${queueResumeTime}.` : 'Aguardando retomada automática.'}</p> : null}</div></div>,
  }

  return <section className="space-y-2" aria-label="Ferramentas da conta">
    {loadFailed ? <button type="button" className="btn-ghost min-h-10 self-start text-xs text-warning" onClick={() => void Promise.all([mutateProfit(), mutateProfitConfig(), mutateAnomalies(), mutateCloud(), mutateQueue()])}>Alguns dados não foram atualizados · tentar novamente</button> : null}
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-sm font-semibold text-foreground">Ferramentas da conta</h2><p className="mt-1 text-xs text-muted-foreground">Custos, análise, vídeos e proteção.</p></div><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => setOrganizing((v) => !v)}>{organizing ? 'Concluir' : 'Organizar'}</button></div>
    <div className="divide-y divide-border/60 border-y border-border/60">{order.map((id) => <div key={id} draggable={organizing} onDragStart={() => organizing && setDragging(id)} onDragOver={(e) => organizing && e.preventDefault()} onDrop={() => moveWidget(id)} onDragEnd={() => setDragging(null)} className={dragging === id ? 'opacity-50' : ''}>{organizing ? <div className="flex justify-end pt-2"><GripVertical className="size-4 cursor-grab text-muted-foreground" aria-label="Arraste para reorganizar" /></div> : null}{sections[id]}</div>)}</div>
    <ConfirmDialog open={Boolean(confirmCloudConnect)} title={confirmCloudConnect === 'googleDrive' ? 'Sair para conectar Google Drive?' : 'Sair para conectar Dropbox?'} description="Existem alterações não salvas nesta área. Continuar descartará esses rascunhos locais." confirmLabel="Abrir conexão" appearance="quiet" tone="danger" onConfirm={() => { const provider = confirmCloudConnect; if (provider) void performCloudConnect(provider) }} onClose={() => setConfirmCloudConnect(null)} />
  </section>
}
