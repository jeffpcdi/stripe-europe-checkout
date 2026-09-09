'use client'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { DialogPortal } from '@/components/ui/dialog-portal'

import { useRef, useState } from 'react'
import {
  Users,
  UserCheck,
  UserPlus,
  Plus,
  Trash2,
  RefreshCw,
  Loader2,
  X,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
} from 'lucide-react'
import { useAdsCustomAudiences, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCustomAudience } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

interface AudiencesDialogProps {
  open: boolean
  onClose: () => void
  advertiserId: string
}

export function AudiencesDialog({ open, onClose, advertiserId }: AudiencesDialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, isLoading, mutate, error } = useAdsCustomAudiences(open, advertiserId)
  const audiences = data?.audiences || []
  const availableSources = audiences.filter(audience => audience.isValid && !audience.type.toUpperCase().includes('LOOKALIKE'))

  const [creatingPreset, setCreatingPreset] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showLookalikeForm, setShowLookalikeForm] = useState(false)
  const [sourceAudienceId, setSourceAudienceId] = useState('')
  const [lookalikeName, setLookalikeName] = useState('')
  const [lookalikeType, setLookalikeType] = useState<'BALANCE' | 'SIMILARITY' | 'REACH'>('BALANCE')
  const [creatingLookalike, setCreatingLookalike] = useState(false)

  const busy = creatingPreset !== null || deletingId !== null || creatingLookalike
  useModalA11y(open, ref, busy ? () => {} : onClose)

  if (!open) return null

  async function handleCreatePreset(type: 'purchasers' | 'checkout' | 'viewers') {
    setCreatingPreset(type)
    try {
      let name = ''
      let event = ''
      let retentionDays = 30

      if (type === 'purchasers') {
        name = 'Compradores (30 dias)'
        event = 'Purchase'
        retentionDays = 30
      } else if (type === 'checkout') {
        name = 'Iniciou Checkout (7 dias)'
        event = 'InitiateCheckout'
        retentionDays = 7
      } else if (type === 'viewers') {
        name = 'Visitantes da página (14 dias)'
        event = 'ViewContent'
        retentionDays = 14
      }

      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences', 'POST', {
        adAccountId: advertiserId,
        name,
        event,
        retentionDays,
      })

      if (result.dryRun) { toast.info('Simulação concluída. Os públicos não foram alterados.'); return }
      toast.success(`Público "${name}" criado com sucesso!`, {
        hint: 'O TikTok está sincronizando e processando os dados.',
      })
      await mutate()
    } catch (err) {
      toast.error('Não foi possível criar o público', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setCreatingPreset(null)
    }
  }

  async function handleCreateLookalike(e: React.FormEvent) {
    e.preventDefault()
    if (!sourceAudienceId) {
      toast.error('Selecione um público semente e informe um nome')
      return
    }

    setCreatingLookalike(true)
    try {
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences/lookalike', 'POST', {
        adAccountId: advertiserId,
        name: lookalikeName.trim() || ('Semelhante — ' + (availableSources.find((audience) => audience.id === sourceAudienceId)?.name || 'Público')).slice(0, 100),
        sourceAudienceId,
        lookalikeType,
      })

      if (result.dryRun) { toast.info('Simulação concluída. Os públicos não foram alterados.'); return }
      toast.success('Público semelhante criado')
      setShowLookalikeForm(false)
      setLookalikeName('')
      setSourceAudienceId('')
      await mutate()
    } catch (err) {
      toast.error('Erro ao gerar Lookalike', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setCreatingLookalike(false)
    }
  }

  async function handleDelete(id: string) {
    if (busy) return
    setDeletingId(id)
    try {
      const result = await apiSend<{ dryRun?: boolean }>('/api/ads/audiences', 'DELETE', {
        adAccountId: advertiserId,
        audienceId: id,
      })
      if (result.dryRun) { toast.info('Simulação concluída. Os públicos não foram alterados.'); return }
      setConfirmDelete(null)
      toast.success('Público removido')
      await mutate()
    } catch (err) {
      toast.error('Erro ao remover público', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <DialogPortal><div
      className="ads-dialog fixed inset-0 z-50 flex items-center justify-center p-2.5 sm:p-4 bg-background/80 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div
        ref={ref}
        role="dialog" aria-modal="true" aria-labelledby="audiences-dialog-title"
        tabIndex={-1}
        className="relative flex flex-col w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] sm:max-h-[85vh] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-border bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-primary/10 text-primary">
              <Users className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 id="audiences-dialog-title" className="text-sm sm:text-base font-semibold tracking-tight text-foreground">
                Públicos
              </h2>
              <p className="text-xs text-muted-foreground">
                Alcance quem já visitou e encontre pessoas semelhantes.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose} disabled={busy}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 sm:space-y-6">
          {/* Quick 1-Click Creation Presets */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
              <Sparkles className="size-3.5 text-primary" />
              Criar a partir de uma ação
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <button
                type="button"
                disabled={busy || !!error || isLoading}
                onClick={() => handleCreatePreset('purchasers')}
                className="flex flex-col text-left p-3 rounded-xl border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-semibold text-foreground group-hover:text-primary">Compradores</span>
                  {creatingPreset === 'purchasers' ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : (
                    <UserCheck className="size-3.5 text-success" />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground leading-tight">
                  Pessoas que compraram nos últimos 30 dias.
                </span>
              </button>

              <button
                type="button"
                disabled={busy || !!error || isLoading}
                onClick={() => handleCreatePreset('checkout')}
                className="flex flex-col text-left p-3 rounded-xl border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-semibold text-foreground group-hover:text-primary">Abriu o checkout</span>
                  {creatingPreset === 'checkout' ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : (
                    <UserPlus className="size-3.5 text-warning" />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground leading-tight">
                  Pessoas que abriram o checkout nos últimos 7 dias.
                </span>
              </button>

              <button
                type="button"
                disabled={busy || !!error || isLoading}
                onClick={() => handleCreatePreset('viewers')}
                className="flex flex-col text-left p-3 rounded-xl border border-border bg-background hover:border-primary/50 hover:bg-primary/5 transition-all group"
              >
                <div className="flex items-center justify-between w-full mb-1">
                  <span className="text-xs font-semibold text-foreground group-hover:text-primary">Visitou a página</span>
                  {creatingPreset === 'viewers' ? (
                    <Loader2 className="size-3.5 animate-spin text-primary" />
                  ) : (
                    <Users className="size-3.5 text-info" />
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground leading-tight">
                  Últimos 14 dias. Recupere quem acessou sua página.
                </span>
              </button>
            </div>
          </div>

          {/* Lookalike Builder Form */}
          {showLookalikeForm ? (
            <form onSubmit={handleCreateLookalike} className="p-4 rounded-xl border border-primary/30 bg-primary/5 space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-primary" />
                  Novo Público Semelhante (Lookalike)
                </span>
                <button
                  type="button"
                  onClick={() => setShowLookalikeForm(false)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancelar
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Público de origem</label>
                  <select aria-label="Público de origem"
                    className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                    value={sourceAudienceId}
                    onChange={(e) => setSourceAudienceId(e.target.value)}
                    required
                  >
                    <option value="">Selecione o público de origem...</option>
                    {availableSources.map((aud) => (
                      <option key={aud.id} value={aud.id}>
                        {aud.name} ({aud.size.toLocaleString('pt-BR')} pessoas)
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Nome do público (opcional)</label>
                  <input
                    type="text"
                    aria-label="Nome do público"
                    placeholder="Ex.: Pessoas parecidas com compradores"
                    value={lookalikeName}
                    onChange={(e) => setLookalikeName(e.target.value)}
                    className="w-full text-xs rounded-lg border border-border bg-background px-3 py-2 text-foreground"

                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">Tipo de Otimização</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    aria-pressed={lookalikeType === 'SIMILARITY'} onClick={() => setLookalikeType('SIMILARITY')}
                    className={`py-1.5 px-2 text-center text-xs rounded-lg border transition-all ${
                      lookalikeType === 'SIMILARITY'
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    Mais parecido
                  </button>
                  <button
                    type="button"
                    aria-pressed={lookalikeType === 'BALANCE'} onClick={() => setLookalikeType('BALANCE')}
                    className={`py-1.5 px-2 text-center text-xs rounded-lg border transition-all ${
                      lookalikeType === 'BALANCE'
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    Equilibrado
                  </button>
                  <button
                    type="button"
                    aria-pressed={lookalikeType === 'REACH'} onClick={() => setLookalikeType('REACH')}
                    className={`py-1.5 px-2 text-center text-xs rounded-lg border transition-all ${
                      lookalikeType === 'REACH'
                        ? 'border-primary bg-primary/10 text-primary font-medium'
                        : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    Mais amplo
                  </button>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  disabled={busy || !!error}
                  className="btn-primary text-xs px-4 py-2 flex items-center gap-1.5"
                >
                  {creatingLookalike && <Loader2 className="size-3.5 animate-spin" />}
                  Gerar Lookalike no TikTok
                </button>
              </div>
            </form>
          ) : (
            <div className="flex flex-wrap gap-3 justify-between items-center">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Públicos no TikTok Ads ({audiences.length})
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowLookalikeForm(true)}
                  disabled={availableSources.length === 0 || !!error}
                  className="btn-ghost text-xs text-primary flex items-center gap-1 py-1 px-2.5"
                >
                  <Sparkles className="size-3.5" />
                  Criar Lookalike
                </button>
                <button
                  type="button"
                  onClick={() => mutate()}
                  className="p-1 rounded-md text-muted-foreground hover:text-foreground"
                  aria-label="Atualizar lista"
                >
                  <RefreshCw className="size-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* List of Audiences */}
          <div className="space-y-2">
            {isLoading ? (
              <div className="py-8 flex flex-col items-center justify-center gap-2 text-muted-foreground">
                <Loader2 className="size-5 animate-spin text-primary" />
                <span className="text-xs">Consultando públicos no TikTok Ads...</span>
              </div>
            ) : error ? (<p role="alert" className="text-sm text-warning">Não foi possível carregar os públicos. Use Atualizar lista para tentar novamente.</p>) : audiences.length === 0 ? (
              <div className="py-8 text-center border border-dashed border-border rounded-xl p-6 space-y-1">
                <Users className="size-8 text-muted-foreground/50 mx-auto mb-2" />
                <p className="text-xs font-medium text-foreground">Nenhum público personalizado encontrado</p>
                <p className="text-[11px] text-muted-foreground">
                  Use os botões de 1 clique acima para criar seus públicos de compradores ou abandono de checkout.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border border border-border rounded-xl overflow-hidden bg-background">
                {audiences.map((aud) => (
                  <div
                    key={aud.id}
                    className="flex items-center justify-between p-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="p-1.5 rounded-lg bg-muted text-muted-foreground shrink-0">
                        <Users className="size-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-foreground truncate">{aud.name}</p>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span className="px-1.5 py-0.5 rounded bg-secondary text-[10px] uppercase font-mono">
                            {aud.type}
                          </span>
                          <span>•</span>
                          <span>
                            {aud.size > 0
                              ? `${aud.size.toLocaleString('pt-BR')} pessoas estimadas`
                              : 'Tamanho não informado'}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                          aud.isValid
                            ? 'bg-success/10 text-success'
                            : 'bg-warning/10 text-warning'
                        }`}
                      >
                        <CheckCircle2 className="size-3" />
                        {aud.isValid ? 'Pronto' : 'Calculando'}
                      </span>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmDelete(aud.id)}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-error hover:bg-error/10 transition-colors"
                        aria-label="Excluir público"
                      >
                        {deletingId === aud.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="size-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-3 items-center justify-between px-6 py-3.5 border-t border-border bg-muted/20 text-[11px] text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="size-3.5 text-success" />
            <span>O TikTok confirma o tamanho e a disponibilidade de cada público.</span>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="btn-secondary text-xs px-3 py-1.5">
            Fechar
          </button>
        </div>
      </div>
    </div><ConfirmDialog open={!!confirmDelete} title="Excluir público?" description="O público será removido do TikTok Ads. Confira se ele ainda é usado em alguma campanha." confirmLabel="Excluir público" busy={!!deletingId} onConfirm={() => { if (confirmDelete) void handleDelete(confirmDelete) }} onClose={() => setConfirmDelete(null)} /></DialogPortal>
  )
}
