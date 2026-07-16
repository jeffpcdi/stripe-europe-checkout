'use client'

// Item 304: drawer de perfil do lead — clique numa linha da tabela abre o
// painel lateral com identidade, valores, origem e a jornada página a página.
// Consome /api/leads/:id (item 326), que revalida no ritmo padrão (12s),
// então um lead "ao vivo" atualiza a jornada com o drawer aberto.

import { useEffect, useRef, useState } from 'react'
import {
  X,
  MapPin,
  Monitor,
  Smartphone,
  Tablet,
  CreditCard,
  LinkIcon,
  RotateCw,
  Check,
} from 'lucide-react'
import { useLead, apiSend } from '@/lib/api'
import {
  countryFlag,
  fmtCurrencyOrDash,
  formatDateTime,
  formatTime,
  gwLabel,
  pageLabel,
  STAGE_CLASS,
  STAGE_LABEL,
  timeAgo,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { Skeleton } from '@/components/skeleton'

// Item 314: reenviar a conversão deste lead à CAPI. O backend acha o recibo
// MAIS RECENTE do lead no log e re-dispara com registerSale=false + dedupe
// (mesmo event_id) — a venda não é recontabilizada nem duplicada no TikTok.
function CapiReplayButton({ leadId }: { leadId: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'ok' | 'err'>('idle')
  const [msg, setMsg] = useState('')

  async function handleReplay() {
    if (state === 'busy') return
    setState('busy')
    try {
      const r = await apiSend<{ ok: boolean; receipt?: { status?: string; dispatched?: number } }>(
        '/api/ops/reprocess-conversion',
        'POST',
        { leadId },
      )
      const st = r.receipt?.status ?? 'ok'
      if (st === 'ok' || st.startsWith('ok')) {
        setState('ok')
        setMsg(r.receipt?.dispatched ? `${r.receipt.dispatched} pixel(s) receberam` : 'reenviado')
      } else {
        setState('err')
        setMsg(st === 'sem pixel' ? 'nenhum pixel ativo' : st)
      }
    } catch (err) {
      setState('err')
      setMsg(err instanceof Error ? err.message : 'falha ao reprocessar')
    }
    setTimeout(() => setState('idle'), 4000)
  }

  return (
    <button
      type="button"
      onClick={handleReplay}
      disabled={state === 'busy'}
      className={cn(
        'btn-ghost mt-1 self-start !px-2.5 !py-1 text-[11px]',
        state === 'ok' && '!text-success',
        state === 'err' && '!text-warning',
      )}
      title="Reenviar a conversão deste lead à CAPI do TikTok (não recontabiliza a venda)"
    >
      {state === 'busy' ? (
        <>
          <RotateCw className="size-3 animate-spin" aria-hidden /> Reenviando…
        </>
      ) : state === 'ok' ? (
        <>
          <Check className="size-3" aria-hidden /> {msg}
        </>
      ) : state === 'err' ? (
        <>
          <X className="size-3" aria-hidden /> {msg}
        </>
      ) : (
        <>
          <RotateCw className="size-3" aria-hidden /> Reenviar CAPI
        </>
      )}
    </button>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-xs">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right text-foreground">{children}</span>
    </div>
  )
}

export function LeadDrawer({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const { data, error, isLoading } = useLead(leadId)
  const lead = data?.lead
  const panelRef = useRef<HTMLDivElement>(null)

  // Esc fecha; foco entra no painel ao abrir (teclado não fica preso atrás)
  useEffect(() => {
    if (!leadId) return
    panelRef.current?.focus()
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leadId, onClose])

  if (!leadId) return null

  const DeviceIcon =
    lead?.device === 'mobile' ? Smartphone : lead?.device === 'tablet' ? Tablet : Monitor

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Perfil do lead">
      {/* backdrop */}
      <button
        type="button"
        aria-label="Fechar painel"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-3xl"
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        className={cn(
          "anim-drawer-in absolute inset-y-0 right-0 flex w-full max-w-md flex-col overflow-y-auto border-l bg-card shadow-2xl outline-none transition-all duration-500",
          lead?.stage === 'purchased' ? 'shadow-[0_0_60px_rgba(34,197,94,0.15)] border-l-success/40' : 
          lead?.stage === 'abandoned' ? 'shadow-[0_0_60px_rgba(254,44,85,0.15)] border-l-destructive/40' : 
          'border-border/60'
        )}
      >
        <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-border/50 bg-card/95 px-5 py-4 backdrop-blur">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold text-foreground">
              {lead?.customer || 'Lead sem identificação'}
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{leadId}</p>
          </div>
          <button type="button" onClick={onClose} className="btn-ghost !p-2" aria-label="Fechar">
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="flex flex-col gap-5 px-5 py-4">
          {isLoading && !lead ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : error ? (
            <p className="text-sm text-warning">
              {error instanceof Error ? error.message : 'Erro ao carregar o lead.'}
            </p>
          ) : lead ? (
            <>
              {/* etapa + marcações */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={cn(
                    'rounded-md px-2 py-0.5 text-xs font-semibold',
                    STAGE_CLASS[lead.stage] || 'bg-muted/40 text-muted-foreground',
                  )}
                >
                  {STAGE_LABEL[lead.stage] || lead.stage}
                </span>
                {lead.orphan ? (
                  <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning">
                    órfã
                  </span>
                ) : null}
                <span className="ml-auto text-[11px] text-muted-foreground">
                  visto {timeAgo(lead.lastSeen || lead.at)}
                </span>
              </div>

              {/* identidade e contato (data-sensitive respeita modo privacidade) */}
              <section aria-label="Contato" className="flex flex-col gap-1.5" data-sensitive>
                <h3 className="label-mono">Contato</h3>
                <Field label="Nome">{lead.customer || '—'}</Field>
                <Field label="E-mail">{lead.email || '—'}</Field>
                <Field label="Telefone">{lead.phone || '—'}</Field>
              </section>

              {/* origem */}
              <section aria-label="Origem" className="flex flex-col gap-1.5">
                <h3 className="label-mono">Origem</h3>
                <Field label="Local">
                  {lead.country ? (
                    <>
                      <span className="drop-shadow-md" aria-hidden>{countryFlag(lead.country)}</span>{' '}
                      {[lead.city, lead.countryName || lead.country].filter(Boolean).join(', ')}
                    </>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Dispositivo">
                  {lead.device ? (
                    <span className="inline-flex items-center gap-1">
                      <DeviceIcon className="size-3.5 text-muted-foreground" aria-hidden="true" />
                      {[lead.device, lead.os, lead.browser].filter(Boolean).join(' · ')}
                    </span>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Link">
                  {lead.linkSlug ? (
                    <span className="inline-flex items-center gap-1 font-mono">
                      <LinkIcon className="size-3 text-muted-foreground" aria-hidden="true" />/
                      {lead.linkSlug}
                    </span>
                  ) : (
                    '—'
                  )}
                </Field>
                <Field label="Campanha">
                  {lead.utm && Object.keys(lead.utm).length > 0
                    ? [lead.utm.source, lead.utm.campaign].filter(Boolean).join(' / ') || '—'
                    : '—'}
                </Field>
                <Field label="Referência">{lead.referer || '—'}</Field>
              </section>

              {/* pagamento */}
              <section aria-label="Pagamento" className="flex flex-col gap-1.5">
                <h3 className="label-mono">Pagamento</h3>
                <Field label="Gateway">{lead.gateway ? gwLabel(lead.gateway) : '—'}</Field>
                {/* 0 centavos = gateway não reportou valor; mostrar "R$ 0,00"
                    sugeriria venda gratuita, então tratamos como ausente */}
                <Field label="Valor esperado">
                  {fmtCurrencyOrDash(
                    lead.expectedAmount,
                    lead.expectedCurrency || lead.currency,
                    lead.expectedAmount != null,
                  )}
                </Field>
                <Field label="Valor reportado">
                  {fmtCurrencyOrDash(
                    lead.reportedAmount ?? lead.amount,
                    lead.reportedCurrency || lead.currency,
                    (lead.reportedAmount ?? lead.amount) != null,
                  )}
                </Field>
                <Field label="Compra em">
                  {lead.purchasedAt ? formatDateTime(lead.purchasedAt) : '—'}
                </Field>
                {lead.checkoutHits && lead.checkoutHits.length > 0 ? (
                  <Field label="Idas ao checkout">
                    <span className="inline-flex items-center gap-1">
                      <CreditCard className="size-3 text-muted-foreground" aria-hidden="true" />
                      {lead.checkoutHits.length}x — última{' '}
                      {formatTime(lead.checkoutHits[lead.checkoutHits.length - 1]?.at)}
                    </span>
                  </Field>
                ) : null}
                {/* Item 314: só leads que COMPRARAM têm recibo para reprocessar */}
                {lead.stage === 'purchased' ? <CapiReplayButton leadId={lead.id} /> : null}
              </section>

              {/* jornada página a página */}
              <section aria-label="Jornada" className="flex flex-col gap-1.5">
                <h3 className="label-mono">Jornada</h3>
                {lead.journey && lead.journey.length > 0 ? (
                  <ol className="flex flex-col">
                    {lead.journey.map((step, i) => (
                      <li
                        key={`${step.at}-${i}`}
                        className="relative flex items-baseline gap-3 border-l border-border/50 py-1.5 pl-4 text-xs"
                      >
                        <span
                          className={cn(
                            'absolute -left-[3.5px] top-[13px] size-1.5 rounded-full',
                            i === lead.journey!.length - 1 ? 'bg-primary' : 'bg-border',
                          )}
                          aria-hidden="true"
                        />
                        <span className="w-14 shrink-0 font-mono text-muted-foreground">
                          {formatTime(step.at)}
                        </span>
                        <span className="truncate text-foreground">{pageLabel(step.p)}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Sem passos registrados — o lead chegou e saiu na mesma página, ou é uma venda
                    órfã sem rastreamento.
                  </p>
                )}
              </section>

              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <MapPin className="size-3" aria-hidden="true" />
                Primeiro acesso {formatDateTime(lead.at)}
              </p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  )
}
