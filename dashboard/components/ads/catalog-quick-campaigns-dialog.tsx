'use client'

// Modo Turbo: cria N campanhas VSA de um catálogo pronto em 1 clique.
// Sem CSV, sem buscar Pixel ID: quantidade + orçamento e o resto é automático.

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, ChevronDown, Loader2, Rocket, Zap } from 'lucide-react'
import { adsCreateCatalogCampaignBatch, useAdsTikTokPixels } from '@/lib/api'
import { catalogPixelLabel, catalogPixelValue, pickDefaultCatalogPixel } from '@/lib/catalog-pixels'
import { TIKTOK_MIN_BUDGET, TIKTOK_PIXEL_EVENTS, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'

const COUNT_PRESETS = [5, 10, 25, 50]
const MAX_COUNT = 50

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-turbo-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function CatalogQuickCampaignsDialog({
  catalog,
  advertiserId,
  open,
  onClose,
  onCreated,
}: {
  catalog: AdsCatalog
  advertiserId: string
  open: boolean
  onClose: () => void
  onCreated: () => void
}) {
  const [count, setCount] = useState(10)
  const [budget, setBudget] = useState('50')
  const [pixelId, setPixelId] = useState('')
  const [pixelEvent, setPixelEvent] = useState('ON_WEB_ORDER')
  const [namePrefix, setNamePrefix] = useState('')
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, dialogRef, onClose)

  // Pixels da conta carregam ao abrir e o melhor (ativo + mais compras em 30d)
  // já vem selecionado. O gestor não precisa ir buscar o Pixel ID.
  const { data: pixelsData, error: pixelsError, isLoading: pixelsLoading } = useAdsTikTokPixels(open, advertiserId)
  const availablePixels = useMemo(() => (pixelsData?.pixels ?? [])
    .map((pixel) => ({ pixel, value: catalogPixelValue(pixel) }))
    .filter((option) => option.value), [pixelsData?.pixels])

  useEffect(() => {
    if (!open || pixelId || !availablePixels.length) return
    const best = pickDefaultCatalogPixel(pixelsData?.pixels ?? [])
    if (best) setPixelId(best)
  }, [open, pixelId, availablePixels.length, pixelsData?.pixels])

  // Qualquer mudança de material invalida a chave de idempotência para que um
  // novo envio não seja tratado como retry do anterior.
  function material<T>(setter: (value: T) => void) {
    return (value: T) => {
      setter(value)
      idempotencyKeyRef.current = null
    }
  }
  const setCountM = material(setCount)
  const setBudgetM = material(setBudget)
  const setPixelIdM = material(setPixelId)
  const setPixelEventM = material(setPixelEvent)
  const setNamePrefixM = material(setNamePrefix)

  const budgetNumber = Number(String(budget).replace(',', '.'))
  const budgetValid = Number.isFinite(budgetNumber) && budgetNumber >= TIKTOK_MIN_BUDGET
  const pixelValid = /^\d{6,30}$/.test(pixelId.trim())
  const countValid = Number.isInteger(count) && count >= 1 && count <= MAX_COUNT
  const canCreate = countValid && budgetValid && pixelValid && !busy

  const money = useMemo(() => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: catalog.currency || 'BRL', maximumFractionDigits: 2,
  }), [catalog.currency])

  const effectivePrefix = namePrefix.trim() || `${catalog.name} — VSA`
  const pad = String(count).length >= 2 ? String(count).length : 2
  const nameSample = (index: number) => `${effectivePrefix} ${String(index).padStart(pad, '0')}`

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(catalog.currency, ' por dia'))
    if (!pixelValid) {
      return toast.error('Selecione o Pixel do TikTok', {
        hint: 'Escolha um Pixel da lista ou informe os 6 a 30 dígitos do Events Manager.',
      })
    }
    setBusy(true)
    try {
      const result = await adsCreateCatalogCampaignBatch(catalog.id, advertiserId, {
        adAccountId: advertiserId,
        count,
        budgetAmount: budgetNumber,
        budgetType: 'daily',
        budgetOptimization: 'adgroup',
        productScope: 'all',
        pixelId: pixelId.trim(),
        pixelEvent,
        namePrefix: effectivePrefix,
        idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = randomKey()),
      })
      idempotencyKeyRef.current = null
      if (result.dryRun) {
        toast.info('Modo teste: lote validado sem publicar no TikTok', {
          hint: `${result.count ?? count} campanha(s) simulada(s).`,
        })
      } else {
        toast.success(`${result.count ?? count} campanha(s) na fila`, {
          hint: 'O robô cria e verifica uma a uma. Todas nascem pausadas — nenhum gasto até você ativar.',
        })
      }
      onClose()
      onCreated()
    } catch (error) {
      toast.error('Não foi possível criar o lote de campanhas', {
        hint: error instanceof Error ? error.message : undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Criar campanhas do catálogo ${catalog.name}`}
        className="flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl border border-border bg-background p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Zap className="size-4 text-primary" aria-hidden="true" /> Criar campanhas em 1 clique
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Catálogo <strong className="text-foreground">{catalog.name}</strong> · Video Shopping Ads com todos os produtos.
              Nomes, evento e destino são automáticos.
            </p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={busy}>Fechar</button>
        </header>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Quantas campanhas?</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setCountM(preset)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  count === preset
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-secondary/40 text-foreground hover:border-primary/50'
                }`}
              >
                {preset}
              </button>
            ))}
            <input
              className="input-base w-20 text-center text-xs"
              type="number"
              min={1}
              max={MAX_COUNT}
              value={count}
              onChange={(event) => setCountM(Math.max(1, Math.min(MAX_COUNT, Math.trunc(Number(event.target.value) || 1))))}
              aria-label="Quantidade de campanhas"
            />
          </div>
        </div>

        <label className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground">Orçamento diário por campanha ({catalog.currency})</span>
          <input
            className="input-base"
            type="number"
            inputMode="decimal"
            min={TIKTOK_MIN_BUDGET}
            step="1"
            value={budget}
            onChange={(event) => setBudgetM(event.target.value)}
          />
          {!budgetValid && budget.trim() !== '' && (
            <span className="flex items-center gap-1 text-[10px] text-warning" role="alert">
              <AlertCircle className="size-3" aria-hidden="true" /> Mínimo do TikTok: {catalog.currency} {TIKTOK_MIN_BUDGET} por dia.
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1.5 text-xs">
          <span className="font-medium text-foreground">Pixel do TikTok</span>
          {availablePixels.length > 0 ? (
            <select className="input-base" value={pixelId} onChange={(event) => setPixelIdM(event.target.value)}>
              {pixelId && !availablePixels.some((option) => option.value === pixelId) && (
                <option value={pixelId}>Pixel informado manualmente · ID {pixelId}</option>
              )}
              {availablePixels.map(({ pixel, value }) => (
                <option key={`${pixel.id}:${value}`} value={value}>{catalogPixelLabel(pixel)}</option>
              ))}
            </select>
          ) : (
            <input
              className="input-base"
              inputMode="numeric"
              pattern="[0-9]{6,30}"
              minLength={6}
              maxLength={30}
              value={pixelId}
              onChange={(event) => setPixelIdM(event.target.value.replace(/\D/g, '').slice(0, 30))}
              placeholder={pixelsLoading ? 'Carregando Pixels da conta…' : pixelsError ? 'Lista indisponível — informe os dígitos do Pixel' : '1234567890123456789'}
            />
          )}
          <span className="text-[10px] text-muted-foreground">
            {availablePixels.length > 0
              ? 'O Pixel com mais compras em 30 dias já vem selecionado.'
              : pixelsLoading
                ? 'Buscando os Pixels da conta de anúncio…'
                : 'Não foi possível listar os Pixels; informe os dígitos do Events Manager.'}
          </span>
        </div>

        <div className="rounded-lg border border-border bg-secondary/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="block text-foreground">
            {count} campanha{count === 1 ? '' : 's'} × {budgetValid ? money.format(budgetNumber) : '—'}/dia
            {budgetValid && count > 1 ? ` = ${money.format(budgetNumber * count)}/dia no total` : ''}
          </strong>
          Nomes: “{nameSample(1)}”{count > 1 ? ` … “${nameSample(count)}”` : ''}.
          Todas nascem <strong className="text-foreground">pausadas</strong> — nenhum gasto até você ativar.
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="flex items-center gap-1 self-start text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setAdvancedOpen((value) => !value)}
            aria-expanded={advancedOpen}
          >
            <ChevronDown className={`size-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            Opções avançadas
          </button>
          {advancedOpen && (
            <div className="grid gap-3 rounded-lg border border-border bg-secondary/20 p-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Prefixo do nome</span>
                <input
                  className="input-base text-xs"
                  value={namePrefix}
                  onChange={(event) => setNamePrefixM(event.target.value)}
                  placeholder={`${catalog.name} — VSA`}
                  maxLength={100}
                />
              </label>
              <label className="flex flex-col gap-1 text-[11px] text-muted-foreground">
                <span className="font-medium text-foreground">Evento de otimização</span>
                <select className="input-base text-xs" value={pixelEvent} onChange={(event) => setPixelEventM(event.target.value)}>
                  {TIKTOK_PIXEL_EVENTS.map((event) => <option key={event.value} value={event.value}>{event.label}</option>)}
                </select>
              </label>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn-primary text-xs" onClick={create} disabled={!canCreate}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar {count} campanha{count === 1 ? '' : 's'}
          </button>
        </footer>
      </div>
    </div>
  )
}
