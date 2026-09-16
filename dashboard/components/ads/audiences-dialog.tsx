'use client'

import { useMemo, useRef, useState } from 'react'
import { Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DialogPortal } from '@/components/ui/dialog-portal'
import { apiSend, useAdsCustomAudiences, useAdsTikTokPixels } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCustomAudience } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { defaultMarket, MarketSelector, type AdMarket } from './market-selector'

interface AudiencesDialogProps {
  open: boolean
  onClose: () => void
  advertiserId: string
  onConfigurePixel?: () => void
}

const PRESETS = [
  { key: 'purchasers', name: 'Compradores', detail: 'Pessoas que compraram nos últimos 30 dias.', meta: 'Compra · 30 dias · atualização automática', event: 'Purchase', retentionDays: 30 },
  { key: 'checkout', name: 'Iniciou checkout', detail: 'Pessoas que chegaram ao checkout nos últimos 7 dias.', meta: 'Checkout · 7 dias · atualização automática', event: 'InitiateCheckout', retentionDays: 7 },
  { key: 'viewers', name: 'Visitou página', detail: 'Pessoas que visitaram a página nos últimos 14 dias.', meta: 'Visita · 14 dias · atualização automática', event: 'ViewContent', retentionDays: 14 },
] as const

function audienceTypeLabel(type: string) {
  const upper = String(type || '').toUpperCase()
  if (upper.includes('LOOKALIKE')) return 'Público semelhante'
  if (upper.includes('PIXEL') || upper.includes('WEBSITE')) return 'Pixel'
  return String(type || 'Público').replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())
}

function audienceStatus(audience: AdsCustomAudience) {
  if (audience.isValid) return { label: 'Pronto', tone: 'text-success', dot: 'bg-success' }
  return { label: 'Calculando', tone: 'text-warning', dot: 'bg-warning' }
}

function formatSize(size: number) {
  return Number(size) > 0 ? `${Number(size).toLocaleString('pt-BR')} pessoas estimadas` : 'Tamanho ainda indisponível'
}

export function AudiencesDialog({ open, onClose, advertiserId, onConfigurePixel }: AudiencesDialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, isLoading, mutate, error } = useAdsCustomAudiences(open, advertiserId)
  const { data: pixelState, isLoading: pixelLoading } = useAdsTikTokPixels(open && Boolean(advertiserId), advertiserId)
  const audiences = data?.audiences || []
  const availableSources = useMemo(() => audiences.filter(audience => audience.isValid && !audience.type.toUpperCase().includes('LOOKALIKE')), [audiences])
  const readyAudiences = audiences.filter(audience => audience.isValid).length
  const lookalikeAudiences = audiences.filter(audience => audience.type.toUpperCase().includes('LOOKALIKE')).length
  const pixelReady = Boolean(pixelState?.ready && pixelState.binding)

  const [creatingPreset, setCreatingPreset] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdsCustomAudience | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showLookalikeForm, setShowLookalikeForm] = useState(false)
  const [sourceAudienceId, setSourceAudienceId] = useState('')
  const [lookalikeName, setLookalikeName] = useState('')
  const [lookalikeType, setLookalikeType] = useState<'BALANCE' | 'SIMILARITY' | 'REACH'>('BALANCE')
  const [market, setMarket] = useState<AdMarket>(defaultMarket('BR'))
  const [creatingLookalike, setCreatingLookalike] = useState(false)

  const busy = creatingPreset !== null || deletingId !== null || creatingLookalike
  useModalA11y(open, ref, busy ? () => {} : onClose)

  if (!open) return null

  async function handleCreatePreset(preset: typeof PRESETS[number]) {
    if (!pixelReady) {
      toast.info('Configure o Pixel da conta antes de criar públicos de remarketing.')
      return
    }
    setCreatingPreset(preset.key)
    try {
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences', 'POST', {
        adAccountId: advertiserId,
        name: preset.key === 'purchasers' ? 'Compradores (30 dias)' : preset.key === 'checkout' ? 'Iniciou Checkout (7 dias)' : 'Visitantes da página (14 dias)',
        event: preset.event,
        retentionDays: preset.retentionDays,
      })
      if (result.dryRun) { toast.info('Simulação concluída. Nenhum público foi criado no TikTok.'); return }
      toast.success('Público criado', { hint: 'O TikTok está processando os dados e manterá o público atualizado.' })
      await mutate()
    } catch (err) {
      toast.error('Não foi possível criar o público', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setCreatingPreset(null)
    }
  }

  async function handleCreateLookalike(e: React.FormEvent) {
    e.preventDefault()
    if (!sourceAudienceId) {
      toast.error('Selecione o público de origem.')
      return
    }
    setCreatingLookalike(true)
    try {
      const sourceName = availableSources.find((audience) => audience.id === sourceAudienceId)?.name || 'Público'
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences/lookalike', 'POST', {
        adAccountId: advertiserId,
        name: lookalikeName.trim() || `Semelhante — ${sourceName}`.slice(0, 100),
        sourceAudienceId,
        lookalikeType,
        countries: market.countries,
      })
      if (result.dryRun) { toast.info('Simulação concluída. Nenhum público foi criado no TikTok.'); return }
      toast.success('Público semelhante criado', { hint: 'O TikTok começará a calcular o tamanho do público.' })
      setShowLookalikeForm(false)
      setLookalikeName('')
      setSourceAudienceId('')
      setMarket(defaultMarket('BR'))
      await mutate()
    } catch (err) {
      toast.error('Não foi possível criar o público semelhante', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setCreatingLookalike(false)
    }
  }

  async function handleDelete(id: string) {
    if (busy || deletingId) return
    setDeletingId(id)
    try {
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences', 'DELETE', { adAccountId: advertiserId, audienceId: id })
      if (result.dryRun) toast.info('Simulação concluída. Nenhum público foi removido do TikTok.')
      else toast.success('Público removido')
      setConfirmDelete(null)
      if (!result.dryRun) await mutate()
    } catch (err) {
      toast.error('Erro ao remover público', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setDeletingId(null)
    }
  }

  const source = availableSources.find((audience) => audience.id === sourceAudienceId)
  const similarityLabel = lookalikeType === 'SIMILARITY' ? 'Mais parecido' : lookalikeType === 'REACH' ? 'Mais amplo' : 'Equilibrado'

  return <>
    <DialogPortal><div className="ads-dialog fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-2.5 backdrop-blur-sm sm:p-4">
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="audiences-dialog-title" tabIndex={-1} className="relative flex max-h-[calc(100dvh-1.5rem)] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none sm:max-h-[88vh]">
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-4 sm:px-6">
          <div>
            <h2 id="audiences-dialog-title" className="text-base font-semibold text-foreground">Públicos</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Crie públicos de remarketing pelo Pixel da conta e públicos semelhantes para expansão.</p>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground" aria-label="Fechar"><X className="size-4" /></button>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-6">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <span>{audiences.length} público{audiences.length === 1 ? '' : 's'}</span><span>·</span><span>{readyAudiences} pronto{readyAudiences === 1 ? '' : 's'}</span><span>·</span><span>{lookalikeAudiences} semelhante{lookalikeAudiences === 1 ? '' : 's'}</span>
          </div>

          <section className="border-b border-border/60 pb-5">
            <h3 className="text-sm font-semibold text-foreground">Pixel da conta</h3>
            {pixelLoading ? <p className="mt-2 text-xs text-muted-foreground">Verificando Pixel…</p> : pixelReady ? (
              <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><span className="size-2 rounded-full bg-success" />Pronto · {pixelState?.binding?.pixelName || pixelState?.binding?.pixelCode || 'Pixel vinculado'}</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-medium text-warning">Pixel necessário para criar públicos de remarketing</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Compradores, checkout e visitantes usam os eventos do Pixel vinculado à conta.</p></div>
                {onConfigurePixel && <button type="button" className="btn-secondary min-h-10 shrink-0 text-xs" onClick={onConfigurePixel}>Configurar Pixel</button>}
              </div>
            )}
          </section>

          <section>
            <h3 className="text-sm font-semibold text-foreground">Remarketing</h3>
            <div className="mt-2 divide-y divide-border/50 border-y border-border/60">
              {PRESETS.map((preset) => <div key={preset.key} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div><p className="text-sm font-medium text-foreground">{preset.name} · {preset.retentionDays} dias</p><p className="mt-1 text-xs text-muted-foreground">{preset.detail}</p><p className="mt-1 text-xs text-muted-foreground">{preset.meta}</p></div>
                <button type="button" disabled={busy || !!error || isLoading || !pixelReady} onClick={() => handleCreatePreset(preset)} className="btn-secondary min-h-10 shrink-0 text-xs">
                  {creatingPreset === preset.key && <Loader2 className="size-3.5 animate-spin" />}Criar público
                </button>
              </div>)}
            </div>
          </section>

          <section className="border-b border-border/60 pb-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div><h3 className="text-sm font-semibold text-foreground">Público semelhante</h3><p className="mt-1 text-xs text-muted-foreground">Expanda a partir de um público pronto sem alterar o público de origem.</p></div>
              <button type="button" className="btn-secondary min-h-10 text-xs" onClick={() => setShowLookalikeForm((value) => !value)}>{showLookalikeForm ? 'Recolher' : 'Criar público semelhante'}</button>
            </div>
            {showLookalikeForm && <form onSubmit={handleCreateLookalike} className="mt-4 space-y-4 rounded-xl border border-border/70 bg-secondary/10 p-4">
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Público de origem</span><select className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={sourceAudienceId} onChange={(e) => setSourceAudienceId(e.target.value)}><option value="">Selecione um público</option>{availableSources.map((audience) => <option key={audience.id} value={audience.id}>{audience.name} · {formatSize(audience.size)}</option>)}</select></label>
              <MarketSelector value={market} onChange={setMarket} disabled={creatingLookalike} languageAvailable={false} appearance="creation" />
              <div><p className="text-xs font-medium text-foreground">Semelhança</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{([
                ['SIMILARITY', 'Mais parecido', 'Menor alcance, maior proximidade com a origem.'],
                ['BALANCE', 'Equilibrado', 'Equilíbrio entre semelhança e alcance.'],
                ['REACH', 'Mais amplo', 'Maior alcance, menor proximidade com a origem.'],
              ] as const).map(([value, label, detail]) => <label key={value} className={`cursor-pointer rounded-lg border p-3 ${lookalikeType === value ? 'border-primary/60 bg-primary/5' : 'border-border/70 bg-background'}`}><input type="radio" className="sr-only" name="lookalikeType" value={value} checked={lookalikeType === value} onChange={() => setLookalikeType(value)} /><span className="text-sm font-medium text-foreground">{label}</span>{value === 'BALANCE' && <span className="ml-1 text-xs text-muted-foreground">· Recomendado</span>}<p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p></label>)}</div></div>
              <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Nome opcional</span><input className="input-base min-h-10 rounded-lg border border-border bg-background px-3 text-sm" value={lookalikeName} maxLength={100} onChange={(e) => setLookalikeName(e.target.value)} placeholder={source ? `Semelhante — ${source.name}` : 'Gerado a partir do público de origem'} /></label>
              {source && <div className="border-t border-border/60 pt-3 text-xs text-muted-foreground"><p className="font-medium text-foreground">Revisão</p><p className="mt-1">Origem: {source.name}</p><p>País: {market.countries[0] === 'BR' ? 'Brasil' : market.countries[0]}</p><p>Semelhança: {similarityLabel}</p><p>Nome: {lookalikeName.trim() || `Semelhante — ${source.name}`}</p></div>}
              <div className="flex justify-end"><button type="submit" className="btn-primary min-h-10 text-xs" disabled={creatingLookalike || !sourceAudienceId}>{creatingLookalike && <Loader2 className="size-3.5 animate-spin" />}Criar público semelhante</button></div>
            </form>}
          </section>

          <section>
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold text-foreground">Públicos da conta</h3><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => mutate()} disabled={isLoading}><RefreshCw className={`size-3.5 ${isLoading ? 'animate-spin' : ''}`} />Atualizar</button></div>
            {isLoading && !data ? <p className="py-6 text-xs text-muted-foreground">Consultando públicos no TikTok Ads…</p> : error ? <div className="py-5"><p className="text-sm font-medium text-warning">Não foi possível carregar os públicos</p><button type="button" className="btn-secondary mt-3 min-h-10 text-xs" onClick={() => mutate()}>Tentar novamente</button></div> : audiences.length === 0 ? <div className="py-7 text-center"><p className="text-sm font-medium text-foreground">Nenhum público criado</p><p className="mt-1 text-xs text-muted-foreground">Crie um público de remarketing acima ou gere um público semelhante quando houver uma origem pronta.</p></div> : <ul className="mt-2 divide-y divide-border/50 border-y border-border/60">{audiences.map((audience) => { const status = audienceStatus(audience); return <li key={audience.id} className="flex items-start gap-3 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-foreground">{audience.name}</p><p className="mt-1 text-xs text-muted-foreground">{audienceTypeLabel(audience.type)} · {formatSize(audience.size)}</p></div><div className="flex shrink-0 items-center gap-2"><span className={`flex items-center gap-1.5 text-xs ${status.tone}`}><span className={`size-2 rounded-full ${status.dot}`} />{status.label}</span><button type="button" className="flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs text-muted-foreground hover:bg-error/10 hover:text-error" onClick={() => setConfirmDelete(audience)} disabled={busy}><Trash2 className="size-3.5" />Remover</button></div></li>})}</ul>}
          </section>
        </div>
      </div>
    </div></DialogPortal>
    <ConfirmDialog open={Boolean(confirmDelete)} title="Excluir este público?" description="Ele será removido do TikTok Ads. Se ainda estiver em uso, o TikTok poderá recusar a exclusão ou a campanha poderá exigir ajuste." confirmLabel="Excluir público" appearance="quiet" busy={Boolean(deletingId)} onConfirm={() => { if (confirmDelete) return handleDelete(confirmDelete.id) }} onClose={() => setConfirmDelete(null)} />
  </>
}
