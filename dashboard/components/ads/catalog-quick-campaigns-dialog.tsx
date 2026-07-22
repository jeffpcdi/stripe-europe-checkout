'use client'

// Lote rápido: quantidade e orçamento são as únicas escolhas obrigatórias.
// Pixel, evento de Compra, catálogo, público e Product Link vêm do backend.

import { useMemo, useRef, useState } from 'react'
import { AlertCircle, Loader2, Rocket, Zap } from 'lucide-react'
import { adsCreateCatalogCampaignBatch } from '@/lib/api'
import { TIKTOK_MIN_BUDGET, tiktokMinimumBudgetMessage } from './tiktok-contracts'
import type { AdsCatalog } from '@/lib/types'
import { toast } from '@/lib/toast'
import { useModalA11y } from '@/lib/use-modal-a11y'

const COUNT_PRESETS = [5, 10, 25, 50]
const MAX_COUNT = 50

function randomKey() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `catalog-batch-${Date.now()}-${Math.random().toString(16).slice(2)}`
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
  const [namePrefix, setNamePrefix] = useState('')
  const [busy, setBusy] = useState(false)
  const idempotencyKeyRef = useRef<string | null>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(open, dialogRef, onClose)

  function update<T>(setter: (value: T) => void, value: T) {
    setter(value)
    idempotencyKeyRef.current = null
  }

  const budgetNumber = Number(String(budget).replace(',', '.'))
  const budgetValid = Number.isFinite(budgetNumber) && budgetNumber >= TIKTOK_MIN_BUDGET
  const countValid = Number.isInteger(count) && count >= 1 && count <= MAX_COUNT
  const effectivePrefix = namePrefix.trim() || `${catalog.name} — VSA`
  const pad = Math.max(2, String(count).length)
  const sampleName = (index: number) => `${effectivePrefix} ${String(index).padStart(pad, '0')}`
  const money = useMemo(() => new Intl.NumberFormat('pt-BR', {
    style: 'currency', currency: catalog.currency || 'BRL', maximumFractionDigits: 2,
  }), [catalog.currency])

  async function create() {
    if (!countValid) return toast.error(`Escolha de 1 a ${MAX_COUNT} campanhas`)
    if (!budgetValid) return toast.error(tiktokMinimumBudgetMessage(catalog.currency, ' por dia'))
    setBusy(true)
    try {
      const result = await adsCreateCatalogCampaignBatch(catalog.id, advertiserId, {
        count,
        budgetAmount: budgetNumber,
        budgetType: 'daily',
        budgetOptimization: 'adgroup',
        productScope: 'all',
        namePrefix: effectivePrefix,
        idempotencyKey: idempotencyKeyRef.current || (idempotencyKeyRef.current = randomKey()),
      })
      idempotencyKeyRef.current = null
      if (result.dryRun) {
        toast.info('Modo teste: lote validado sem publicar', { hint: `${result.count ?? count} campanha(s) simulada(s).` })
      } else {
        toast.success(`${result.count ?? count} campanha(s) na fila`, { hint: 'Todas serão verificadas e permanecerão pausadas.' })
      }
      onClose()
      onCreated()
    } catch (error) {
      toast.error('Não foi possível criar o lote', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-4" role="presentation">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Criar lote de campanhas do catálogo ${catalog.name}`}
        className="flex max-h-[92dvh] w-full flex-col gap-4 overflow-y-auto rounded-t-2xl border border-border bg-background p-4 shadow-2xl sm:max-w-lg sm:rounded-2xl sm:p-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Zap className="size-4 text-primary" aria-hidden="true" /> Criar lote
            </h3>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              Mesmo catálogo, configurações automáticas e campanhas pausadas.
            </p>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={busy}>Fechar</button>
        </header>

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-foreground">Quantidade</span>
          <div className="flex flex-wrap items-center gap-1.5">
            {COUNT_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => update(setCount, preset)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${count === preset ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-secondary/40 text-foreground hover:border-primary/50'}`}
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
              onChange={(event) => update(setCount, Math.max(1, Math.min(MAX_COUNT, Math.trunc(Number(event.target.value) || 1))))}
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
            onChange={(event) => update(setBudget, event.target.value)}
          />
          {!budgetValid && budget.trim() !== '' && (
            <span className="flex items-center gap-1 text-[10px] text-warning" role="alert">
              <AlertCircle className="size-3" aria-hidden="true" /> Mínimo: {catalog.currency} {TIKTOK_MIN_BUDGET}/dia.
            </span>
          )}
        </label>

        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-[11px] leading-relaxed text-muted-foreground">
          <strong className="block text-foreground">
            {count} campanha{count === 1 ? '' : 's'} · {budgetValid ? money.format(budgetNumber * count) : '—'}/dia no total
          </strong>
          Pixel e evento Compra serão aplicados automaticamente. Cada produto usa o próprio Link e tudo nasce pausado.
        </div>

        <details className="rounded-lg border border-border px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-medium text-muted-foreground">Personalizar nomes</summary>
          <label className="mt-3 flex flex-col gap-1 text-[11px] text-muted-foreground">
            Prefixo
            <input
              className="input-base text-xs"
              value={namePrefix}
              onChange={(event) => update(setNamePrefix, event.target.value)}
              placeholder={`${catalog.name} — VSA`}
              maxLength={100}
            />
            <span>Ex.: “{sampleName(1)}”{count > 1 ? ` até “${sampleName(count)}”` : ''}</span>
          </label>
        </details>

        <footer className="flex items-center justify-end gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={busy}>Cancelar</button>
          <button type="button" className="btn-primary text-xs" onClick={create} disabled={!countValid || !budgetValid || busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
            Criar lote
          </button>
        </footer>
      </div>
    </div>
  )
}
