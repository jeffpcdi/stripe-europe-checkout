'use client'

import { DialogPortal } from '@/components/ui/dialog-portal'

// Saúde das contas de anúncio + tickets de desbanimento (semi-automático).
// O TikTok NÃO tem API de appeal: quando o painel detecta um banimento, o
// backend abre um ticket com texto de recurso pré-gerado e link pro
// formulário oficial — aqui o usuário revisa, copia e envia com 1 clique.
// Reativação detectada resolve o ticket automaticamente.

import { useRef, useState } from 'react'
import {
  HeartPulse,
  Loader2,
  CheckCircle2,
  Ban,
  TriangleAlert,
  Clock,
  HelpCircle,
  Copy,
  ExternalLink,
  RotateCcw,
  Send,
  X,
} from 'lucide-react'
import { useAdsHealth, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAccountHealth, AdsHealthStatus, AdsUnbanTicket } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const STATUS_META: Record<AdsHealthStatus, { label: string; tone: string; chip: string }> = {
  approved: { label: 'aprovada', tone: 'text-success', chip: 'border-success/30 bg-success/10 text-success' },
  banned: { label: 'banida', tone: 'text-error', chip: 'border-error/40 bg-error/10 text-error' },
  limited: { label: 'limitada', tone: 'text-warning', chip: 'border-warning/40 bg-warning/10 text-warning' },
  in_review: { label: 'em revisão', tone: 'text-warning', chip: 'border-warning/30 bg-warning/10 text-warning' },
  unknown: { label: 'desconhecido', tone: 'text-muted-foreground', chip: 'border-border bg-secondary/40 text-muted-foreground' },
}

const TICKET_META: Record<AdsUnbanTicket['status'], { label: string; tone: string }> = {
  open: { label: 'aberto', tone: 'text-error' },
  submitted: { label: 'recurso enviado', tone: 'text-warning' },
  resolved: { label: 'resolvido', tone: 'text-success' },
  dismissed: { label: 'dispensado', tone: 'text-muted-foreground' },
}

function StatusIcon({ status }: { status: AdsHealthStatus }) {
  if (status === 'approved') return <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden="true" />
  if (status === 'banned') return <Ban className="size-3.5 shrink-0 text-error" aria-hidden="true" />
  if (status === 'limited') return <TriangleAlert className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
  if (status === 'in_review') return <Clock className="size-3.5 shrink-0 text-warning" aria-hidden="true" />
  return <HelpCircle className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
}

function fmtWhen(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function TicketCard({
  ticket,
  appealUrl,
  onChanged,
}: {
  ticket: AdsUnbanTicket
  appealUrl: string
  onChanged: () => void
}) {
  const [text, setText] = useState(ticket.appeal_text ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const meta = TICKET_META[ticket.status]
  const active = ticket.status === 'open' || ticket.status === 'submitted'

  async function patchTicket(patch: { status?: string; appealText?: string }, okMsg: string) {
    setBusy(patch.status || 'text')
    try {
      await apiSend(`/api/ads/tickets/${encodeURIComponent(ticket.id)}`, 'PATCH', patch)
      toast.success(okMsg)
      onChanged()
    } catch (e) {
      toast.error('Falha ao atualizar o ticket', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  async function regenerate() {
    setBusy('regen')
    try {
      const r = await apiSend<{ ticket: AdsUnbanTicket }>(
        `/api/ads/tickets/${encodeURIComponent(ticket.id)}/regenerate`,
        'POST',
      )
      setText(r.ticket.appeal_text ?? '')
      toast.success('Texto do recurso regenerado')
      onChanged()
    } catch (e) {
      toast.error('Falha ao regenerar o texto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(null)
    }
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Texto copiado', { hint: 'Cole no formulário oficial do TikTok e envie.' })
    } catch {
      toast.error('Falha ao copiar — selecione e copie manualmente.')
    }
  }

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {ticket.advertiser_name || ticket.advertiser_id}
          </p>
          <p className="text-[11px] text-muted-foreground">
            Ticket criado em {fmtWhen(ticket.created_at)}
            {ticket.submitted_at ? ` · enviado em ${fmtWhen(ticket.submitted_at)}` : ''}
            {ticket.resolved_at ? ` · encerrado em ${fmtWhen(ticket.resolved_at)}` : ''}
          </p>
        </div>
        <span className={`shrink-0 text-[11px] font-semibold ${meta.tone}`}>{meta.label}</span>
      </div>

      {active && (
        <>
          <label className="flex flex-col gap-1">
            <span className="text-[11px] font-medium text-muted-foreground">
              Texto do recurso (edite antes de enviar)
            </span>
            <textarea
              className="input-neon min-h-32 w-full rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (text !== (ticket.appeal_text ?? '')) patchTicket({ appealText: text }, 'Texto do recurso salvo')
              }}
              aria-label={`Texto do recurso para ${ticket.advertiser_name || ticket.advertiser_id}`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" className="btn-ghost text-xs" onClick={copyText}>
              <Copy className="size-3.5" aria-hidden="true" />
              Copiar texto
            </button>
            <a
              className="btn-primary text-xs"
              href={ticket.appeal_url || appealUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="size-3.5" aria-hidden="true" />
              Abrir formulário do TikTok
            </a>
            {ticket.status === 'open' && (
              <button
                type="button"
                className="btn-ghost text-xs"
                disabled={busy !== null}
                onClick={() => patchTicket({ status: 'submitted' }, 'Ticket marcado como enviado')}
              >
                {busy === 'submitted' ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-3.5" aria-hidden="true" />
                )}
                Marcar como enviado
              </button>
            )}
            <button type="button" className="btn-ghost text-xs" disabled={busy !== null} onClick={regenerate}>
              {busy === 'regen' ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <RotateCcw className="size-3.5" aria-hidden="true" />
              )}
              Regenerar
            </button>
            <button
              type="button"
              className="btn-ghost text-xs text-muted-foreground"
              disabled={busy !== null}
              onClick={() => patchTicket({ status: 'dismissed' }, 'Ticket dispensado')}
            >
              Dispensar
            </button>
          </div>
        </>
      )}
      {ticket.notes && <p className="text-pretty text-[11px] text-muted-foreground">{ticket.notes}</p>}
    </li>
  )
}

export function HealthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, mutate, isLoading, error } = useAdsHealth(open)
  useModalA11y(open, ref, onClose)

  if (!open) return null

  const health: AdsAccountHealth[] = data?.health ?? []
  const tickets: AdsUnbanTicket[] = data?.tickets ?? []
  const activeTickets = tickets.filter((t) => t.status === 'open' || t.status === 'submitted')
  const closedTickets = tickets.filter((t) => t.status === 'resolved' || t.status === 'dismissed')

  return (
    <DialogPortal><div
      className="ads-dialog fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ads-health-title" tabIndex={-1} className="anim-pop-in relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl outline-none">
        <div className="flex items-center justify-between gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
              <HeartPulse className="size-4 text-primary" aria-hidden="true" />
            </span>
            <div>
              <h2 id="ads-health-title" className="text-sm font-semibold text-foreground">
                Saúde das contas
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Monitoramento de banimento + tickets de desbanimento
              </p>
            </div>
          </div>
          <button type="button" className="btn-ghost text-xs" onClick={() => mutate()}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Verificar agora
          </button>
          <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
          {isLoading && !data ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
            </div>
          ) : error ? (
            <div role="alert" className="space-y-3 text-sm text-warning"><p>Não foi possível verificar as contas.</p><button type="button" className="btn-secondary" onClick={() => mutate()}>Tentar novamente</button></div>
          ) : (
            <>
              {data?.enabled === false && (
                <p className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-pretty text-[11px] leading-relaxed text-warning">
                  Persistência Neon indisponível — o monitoramento contínuo e os tickets exigem o banco
                  configurado.
                </p>
              )}

              {/* Status de cada conta de anúncio do token */}
              <section aria-label="Status das contas de anúncio" className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-foreground">Contas de anúncio</h3>
                {health.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
                    Nenhuma conta monitorada ainda. O status aparece aqui após a primeira verificação.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {health.map((h) => {
                      const meta = STATUS_META[h.status] ?? STATUS_META.unknown
                      return (
                        <li
                          key={h.advertiser_id}
                          className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 text-xs"
                        >
                          <StatusIcon status={h.status} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-medium text-foreground">
                              {h.advertiser_name || h.advertiser_id}
                            </p>
                            <p className="text-[11px] text-muted-foreground">
                              Verificado {fmtWhen(h.last_checked_at)}
                              {h.status === 'banned' && h.first_seen_banned_at
                                ? ` · banida desde ${fmtWhen(h.first_seen_banned_at)}`
                                : ''}
                            </p>
                            {h.status_reason && (
                              <p className="mt-0.5 text-pretty text-[11px] text-error">{h.status_reason}</p>
                            )}
                          </div>
                          <span
                            className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${meta.chip}`}
                          >
                            {meta.label}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>

              {/* Tickets de desbanimento */}
              <section aria-label="Tickets de desbanimento" className="flex flex-col gap-1.5">
                <h3 className="text-xs font-semibold text-foreground">
                  Tickets de desbanimento{activeTickets.length > 0 && ` (${activeTickets.length} ativo${activeTickets.length > 1 ? 's' : ''})`}
                </h3>
                <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
                  O TikTok não tem API de recurso: quando um banimento é detectado, o painel gera o texto
                  do recurso automaticamente — revise, copie e envie no formulário oficial.
                </p>
                {tickets.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-xs leading-relaxed text-muted-foreground">
                    Nenhum ticket. Se uma conta for banida, o ticket aparece aqui automaticamente com o
                    texto do recurso pronto.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {activeTickets.map((t) => (
                      <TicketCard key={t.id} ticket={t} appealUrl={data?.appealUrl ?? ''} onChanged={() => mutate()} />
                    ))}
                    {closedTickets.map((t) => (
                      <TicketCard key={t.id} ticket={t} appealUrl={data?.appealUrl ?? ''} onChanged={() => mutate()} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border/50 px-5 py-3">
          <button type="button" className="btn-ghost text-xs" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    </div></DialogPortal>
  )
}
