'use client'

import { useState, useRef } from 'react'
import { Check, CircleX, Loader2, Sparkles, CreditCard, ShieldCheck } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import { toast } from '@/lib/toast'
import { apiSend } from '@/lib/api'
import { useModalA11y } from '@/lib/use-modal-a11y'
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

interface LinkGatewaysModalProps {
  pixel: Pixel
  gateways: Gateway[]
  onClose: () => void
  onSaved: () => void
}

export function LinkGatewaysModal({ pixel, gateways, onClose, onSaved }: LinkGatewaysModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useModalA11y(true, dialogRef, onClose)

  const currentIds = pixel.gatewayIds ?? []
  const [isSpecific, setIsSpecific] = useState<boolean>(currentIds.length > 0)
  const [selectedIds, setSelectedIds] = useState<string[]>(currentIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function handleToggleGateway(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  function handleSelectAll() {
    setSelectedIds(gateways.map((g) => g.id))
  }

  function handleClearAll() {
    setSelectedIds([])
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      // Se não for específico (universal), salvamos array vazio []
      const finalGatewayIds = isSpecific ? selectedIds : []
      await apiSend('/api/pixels', 'POST', {
        slug: pixel.slug,
        gatewayIds: finalGatewayIds,
      })
      toast.success(
        finalGatewayIds.length > 0
          ? `Pixel ${pixel.name} vinculado a ${finalGatewayIds.length} checkout(s)`
          : `Pixel ${pixel.name} configurado para receber de todos os checkouts`
      )
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar vínculos')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label={`Vincular checkouts ao pixel ${pixel.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <GlassCard
        ref={dialogRef}
        tabIndex={-1}
        variant="thick"
        className="w-full max-w-lg p-0 outline-none overflow-hidden border-border/80 shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-brand-cyan/15 text-brand-cyan border border-brand-cyan/20">
              <CreditCard className="size-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground">Vincular Checkouts ao Pixel</h2>
              <p className="text-xs text-muted-foreground font-mono">
                {pixel.name} ({pixel.pixelCode})
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <CircleX className="size-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex flex-col gap-4 p-6">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Escolha quais checkouts devem enviar compras para este pixel. Você pode deixar para receber de todos ou selecionar apenas plataformas específicas.
          </p>

          {/* Modo de Roteamento */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => setIsSpecific(false)}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                !isSpecific
                  ? 'border-brand-cyan/80 bg-brand-cyan/10 shadow-[0_0_12px_rgba(34,211,238,0.15)]'
                  : 'border-border/70 bg-secondary/30 hover:bg-secondary/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-brand-cyan" />
                  Todos os Checkouts
                </span>
                {!isSpecific && <Check className="size-4 text-brand-cyan stroke-[3]" />}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Recebe compras de qualquer checkout cadastrado.
              </span>
            </button>

            <button
              type="button"
              onClick={() => setIsSpecific(true)}
              className={`flex flex-col gap-1 rounded-xl border p-3 text-left transition-all ${
                isSpecific
                  ? 'border-emerald-500/80 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.15)]'
                  : 'border-border/70 bg-secondary/30 hover:bg-secondary/60'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground flex items-center gap-1.5">
                  <CreditCard className="size-3.5 text-emerald-400" />
                  Checkouts Específicos
                </span>
                {isSpecific && <Check className="size-4 text-emerald-400 stroke-[3]" />}
              </div>
              <span className="text-[11px] text-muted-foreground">
                Recebe apenas das plataformas que você marcar abaixo.
              </span>
            </button>
          </div>

          {/* Seleção de Checkouts quando Específico */}
          {isSpecific && (
            <div className="flex flex-col gap-2.5 rounded-2xl border border-border/70 bg-black/40 p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Selecione as plataformas ({selectedIds.length} selecionada(s)):
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-[11px] font-semibold text-brand-cyan hover:underline"
                  >
                    Marcar Todos
                  </button>
                  <span className="text-border text-xs">·</span>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
                  >
                    Limpar
                  </button>
                </div>
              </div>

              {gateways.length === 0 ? (
                <p className="text-xs text-muted-foreground py-3 text-center">
                  Nenhum checkout conectado ainda. Conecte seu checkout primeiro.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5 max-h-56 overflow-y-auto pr-1">
                  {gateways.map((gw) => {
                    const isChecked = selectedIds.includes(gw.id)
                    const color = PROVIDER_COLORS[gw.provider] || '#94a3b8'

                    return (
                      <label
                        key={gw.id}
                        className={`flex items-center justify-between p-2.5 rounded-xl border cursor-pointer select-none transition-all ${
                          isChecked
                            ? 'border-emerald-500/50 bg-emerald-500/10 text-foreground'
                            : 'border-border/50 bg-secondary/20 text-muted-foreground hover:bg-secondary/40'
                        }`}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className="size-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-xs font-semibold text-foreground truncate">
                            {gw.name}
                          </span>
                          <span className="rounded bg-secondary/80 px-1.5 py-0.5 text-[9px] font-mono uppercase text-muted-foreground">
                            {gw.provider}
                          </span>
                        </div>

                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleGateway(gw.id)}
                          className="size-4 accent-emerald-500 rounded cursor-pointer shrink-0"
                        />
                      </label>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {error && (
            <p className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 border-t border-border/60 bg-secondary/20 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary"
          >
            {saving ? (
              <>
                <Loader2 className="size-3.5 animate-spin" />
                Salvando…
              </>
            ) : (
              'Salvar Vínculos'
            )}
          </button>
        </div>
      </GlassCard>
    </div>
  )
}
