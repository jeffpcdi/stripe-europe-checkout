'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, ExternalLink, Loader2, RotateCcw, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DialogPortal } from '@/components/ui/dialog-portal'
import { apiSend, useAdsHealth } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAccountHealth, AdsHealthStatus, AdsUnbanTicket } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const STATUS_META: Record<AdsHealthStatus, { label: string; tone: string; dot: string }> = {
  approved: { label: 'Aprovada', tone: 'text-success', dot: 'bg-success' },
  banned: { label: 'Banida', tone: 'text-error', dot: 'bg-error' },
  limited: { label: 'Limitada', tone: 'text-warning', dot: 'bg-warning' },
  in_review: { label: 'Em revisão', tone: 'text-warning', dot: 'bg-warning' },
  unknown: { label: 'Status desconhecido', tone: 'text-muted-foreground', dot: 'bg-muted-foreground' },
}
const TICKET_META: Record<AdsUnbanTicket['status'], { label: string; tone: string }> = {
  open: { label: 'Aberto', tone: 'text-error' }, submitted: { label: 'Recurso enviado', tone: 'text-warning' }, resolved: { label: 'Resolvido', tone: 'text-success' }, dismissed: { label: 'Dispensado', tone: 'text-muted-foreground' },
}
function fmtWhen(iso: string | null) { if (!iso) return ''; try { return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return iso } }

function TicketRow({ ticket, appealUrl, onChanged, onDirtyChange }: { ticket: AdsUnbanTicket; appealUrl: string; onChanged: () => void; onDirtyChange: (ticketId: string, dirty: boolean) => void }) {
  const [text, setText] = useState(ticket.appeal_text ?? '')
  const [baseline, setBaseline] = useState(ticket.appeal_text ?? '')
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmRegen, setConfirmRegen] = useState(false)
  const [confirmDismiss, setConfirmDismiss] = useState(false)
  const dirty = text !== baseline
  const active = ticket.status === 'open' || ticket.status === 'submitted'
  const meta = TICKET_META[ticket.status]
  useEffect(() => {
    const serverText = ticket.appeal_text ?? ''
    setText((current) => current === baseline ? serverText : current)
    setBaseline(serverText)
  }, [ticket.appeal_text])
  useEffect(() => {
    onDirtyChange(ticket.id, dirty)
    return () => onDirtyChange(ticket.id, false)
  }, [dirty, onDirtyChange, ticket.id])

  async function patchTicket(patch: { status?: string; appealText?: string }, okMsg: string) {
    setBusy(patch.status || 'text')
    try { await apiSend(`/api/ads/tickets/${encodeURIComponent(ticket.id)}`, 'PATCH', patch); if (patch.appealText !== undefined) setBaseline(patch.appealText); toast.success(okMsg); onChanged() }
    catch (e) { toast.error('Falha ao atualizar o ticket', { hint: e instanceof Error ? e.message : undefined }) }
    finally { setBusy(null) }
  }
  async function regenerate() {
    setBusy('regen')
    try { const r = await apiSend<{ ticket: AdsUnbanTicket }>(`/api/ads/tickets/${encodeURIComponent(ticket.id)}/regenerate`, 'POST'); setText(r.ticket.appeal_text ?? ''); setBaseline(r.ticket.appeal_text ?? ''); toast.success('Texto do recurso regenerado'); onChanged() }
    catch (e) { toast.error('Falha ao regenerar o texto', { hint: e instanceof Error ? e.message : undefined }) }
    finally { setBusy(null); setConfirmRegen(false) }
  }
  async function copyText() { try { await navigator.clipboard.writeText(text); toast.success('Texto copiado', { hint: 'Cole no formulário oficial do TikTok e envie.' }) } catch { toast.error('Falha ao copiar — selecione e copie manualmente.') } }

  return <>
    <li className="py-4">
      <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="text-sm font-medium text-foreground">{ticket.advertiser_name || ticket.advertiser_id}</p><p className="mt-1 text-xs text-muted-foreground">Criado em {fmtWhen(ticket.created_at)}{ticket.submitted_at ? ` · enviado em ${fmtWhen(ticket.submitted_at)}` : ''}{ticket.resolved_at ? ` · encerrado em ${fmtWhen(ticket.resolved_at)}` : ''}</p></div><span className={`shrink-0 text-xs ${meta.tone}`}>{meta.label}</span></div>
      {active && <div className="mt-3 space-y-3"><label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-foreground">Texto do recurso</span><textarea className="input-base min-h-36 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm leading-relaxed" value={text} onChange={(e) => setText(e.target.value)} aria-label={`Texto do recurso para ${ticket.advertiser_name || ticket.advertiser_id}`} /></label>{dirty && <p className="text-xs font-medium text-warning">Alterações não salvas</p>}
        <div className="flex flex-wrap gap-2"><a className="btn-primary min-h-10 text-xs" href={ticket.appeal_url || appealUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-3.5" />Abrir formulário do TikTok</a><button type="button" className="btn-secondary min-h-10 text-xs" disabled={!dirty || busy !== null} onClick={() => patchTicket({ appealText: text }, 'Texto do recurso salvo')}>{busy === 'text' && <Loader2 className="size-3.5 animate-spin" />}Salvar texto</button><button type="button" className="btn-ghost min-h-10 text-xs" onClick={copyText}><Copy className="size-3.5" />Copiar texto</button>{ticket.status === 'open' && <button type="button" className="btn-ghost min-h-10 text-xs" disabled={busy !== null || dirty} title={dirty ? 'Salve o texto antes de marcar o recurso como enviado.' : undefined} onClick={() => patchTicket({ status: 'submitted' }, 'Ticket marcado como enviado')}>Marcar como enviado</button>}<button type="button" className="btn-ghost min-h-10 text-xs" disabled={busy !== null} onClick={() => dirty ? setConfirmRegen(true) : regenerate()}><RotateCcw className="size-3.5" />Regenerar</button><button type="button" className="btn-ghost min-h-10 text-xs text-muted-foreground" disabled={busy !== null} onClick={() => setConfirmDismiss(true)}>Dispensar</button></div>
      </div>}
      {ticket.notes && <p className="mt-2 text-xs text-muted-foreground">{ticket.notes}</p>}
    </li>
    <ConfirmDialog open={confirmRegen} title="Substituir o texto atual?" description="Suas alterações não salvas serão perdidas e um novo rascunho será gerado." confirmLabel="Regenerar texto" appearance="quiet" tone="default" busy={busy === 'regen'} onConfirm={regenerate} onClose={() => setConfirmRegen(false)} />
    <ConfirmDialog open={confirmDismiss} title="Dispensar este ticket?" description={dirty ? 'O ticket sairá da lista de pendências e suas alterações não salvas serão descartadas. Isso não altera o status da conta no TikTok.' : 'O ticket sairá da lista de pendências. Isso não altera o status da conta no TikTok.'} confirmLabel="Dispensar ticket" appearance="quiet" tone="danger" busy={busy === 'dismissed'} onConfirm={() => patchTicket({ status: 'dismissed' }, 'Ticket dispensado').finally(() => setConfirmDismiss(false))} onClose={() => setConfirmDismiss(false)} />
  </>
}

export function HealthDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const { data, mutate, isLoading, error } = useAdsHealth(open)
  const [showClosed, setShowClosed] = useState(false)
  const [dirtyTickets, setDirtyTickets] = useState<Set<string>>(() => new Set())
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const handleTicketDirty = useCallback((ticketId: string, dirty: boolean) => {
    setDirtyTickets((current) => {
      const next = new Set(current)
      if (dirty) next.add(ticketId)
      else next.delete(ticketId)
      return next
    })
  }, [])
  function requestClose() {
    if (dirtyTickets.size > 0) setConfirmDiscard(true)
    else onClose()
  }
  useModalA11y(open, ref, requestClose)
  useEffect(() => { if (!open) { setDirtyTickets(new Set()); setConfirmDiscard(false) } }, [open])
  if (!open) return null
  const health: AdsAccountHealth[] = data?.health ?? []
  const tickets: AdsUnbanTicket[] = data?.tickets ?? []
  const activeTickets = tickets.filter((t) => t.status === 'open' || t.status === 'submitted')
  const closedTickets = tickets.filter((t) => t.status === 'resolved' || t.status === 'dismissed')

  return <>
  <DialogPortal><div className="ads-dialog fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-background/80 p-3 backdrop-blur-sm sm:p-4">
    <button type="button" className="absolute inset-0 cursor-default" onClick={requestClose} aria-label="Fechar" tabIndex={-1} />
    <div ref={ref} role="dialog" aria-modal="true" aria-labelledby="ads-health-title" tabIndex={-1} className="relative flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none">
      <div className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-4 sm:px-5"><div><h2 id="ads-health-title" className="text-base font-semibold text-foreground">Saúde das contas</h2><p className="mt-1 text-xs text-muted-foreground">Status das contas e recursos de banimento.</p></div><div className="flex items-center gap-1"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => mutate()}><RotateCcw className="size-3.5" />Verificar agora</button><button type="button" className="flex size-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary/60 hover:text-foreground" onClick={requestClose} aria-label="Fechar"><X className="size-4" /></button></div></div>
      <div className="flex-1 space-y-6 overflow-y-auto p-4 sm:p-5">
        {isLoading && !data ? <p className="py-8 text-center text-xs text-muted-foreground">Verificando contas…</p> : error ? <div><p className="text-sm text-warning">Não foi possível verificar as contas.</p><button type="button" className="btn-secondary mt-3 min-h-10 text-xs" onClick={() => mutate()}>Tentar novamente</button></div> : <>
          {data?.enabled === false && <div className="border-y border-warning/30 py-3"><p className="text-sm font-medium text-warning">Persistência Neon indisponível</p><p className="mt-1 text-xs text-muted-foreground">O monitoramento contínuo e os tickets exigem o banco configurado.</p></div>}
          <section><h3 className="text-sm font-semibold text-foreground">Contas de anúncio</h3>{health.length === 0 ? <div className="py-6 text-center"><p className="text-sm font-medium text-foreground">Nenhuma conta monitorada ainda</p><p className="mt-1 text-xs text-muted-foreground">O status aparece aqui após a primeira verificação.</p></div> : <ul className="mt-2 divide-y divide-border/50 border-y border-border/60">{health.map((h) => { const meta = STATUS_META[h.status] ?? STATUS_META.unknown; return <li key={h.advertiser_id} className="py-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-medium text-foreground">{h.advertiser_name || h.advertiser_id}</p><p className="mt-1 text-xs text-muted-foreground">Verificada {fmtWhen(h.last_checked_at)}{h.status === 'banned' && h.first_seen_banned_at ? ` · banida desde ${fmtWhen(h.first_seen_banned_at)}` : ''}</p></div><span className={`flex shrink-0 items-center gap-1.5 text-xs ${meta.tone}`}><span className={`size-2 rounded-full ${meta.dot}`} />{meta.label}</span></div>{h.status_reason && <p className={`mt-2 text-xs ${h.status === 'banned' ? 'text-error' : 'text-muted-foreground'}`}>{h.status_reason}</p>}</li>})}</ul>}</section>
          <section><h3 className="text-sm font-semibold text-foreground">Tickets de desbanimento{activeTickets.length ? ` · ${activeTickets.length} ativo${activeTickets.length === 1 ? '' : 's'}` : ''}</h3><div className="mt-2 border-y border-border/60 py-3"><p className="text-sm font-medium text-foreground">Como funciona</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">O ROI-NADOS detecta o banimento e prepara um rascunho de recurso. O TikTok não oferece API para enviar o recurso: revise o texto e faça o envio pelo formulário oficial.</p></div>{tickets.length === 0 ? <div className="py-6 text-center"><p className="text-sm font-medium text-foreground">Nenhum ticket</p><p className="mt-1 text-xs text-muted-foreground">Se uma conta for banida, o rascunho aparecerá aqui automaticamente.</p></div> : <><ul className="divide-y divide-border/50 border-b border-border/60">{activeTickets.map((t) => <TicketRow key={t.id} ticket={t} appealUrl={data?.appealUrl ?? ''} onChanged={() => mutate()} onDirtyChange={handleTicketDirty} />)}</ul>{closedTickets.length > 0 && <div className="mt-4"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={() => setShowClosed((value) => !value)}>Encerrados ({closedTickets.length}) · {showClosed ? 'recolher' : 'mostrar'}</button>{showClosed && <ul className="mt-2 divide-y divide-border/50 border-y border-border/60">{closedTickets.map((t) => <TicketRow key={t.id} ticket={t} appealUrl={data?.appealUrl ?? ''} onChanged={() => mutate()} onDirtyChange={handleTicketDirty} />)}</ul>}</div>}</>}</section>
        </>}
      </div>
      <div className="flex justify-end border-t border-border/60 px-4 py-3 sm:px-5"><button type="button" className="btn-ghost min-h-10 text-xs" onClick={requestClose}>Fechar</button></div>
    </div>
  </div></DialogPortal>
  <ConfirmDialog open={confirmDiscard} title="Descartar alterações?" description={dirtyTickets.size === 1 ? 'O texto deste recurso ainda não foi salvo.' : `Há alterações não salvas em ${dirtyTickets.size} recursos.`} confirmLabel="Descartar" appearance="quiet" tone="danger" onConfirm={() => { setConfirmDiscard(false); onClose() }} onClose={() => setConfirmDiscard(false)} />
  </>
}
