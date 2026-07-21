'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Bell, ShoppingCart, CircleX, Undo2, Gavel, LogIn, Megaphone, Info } from 'lucide-react'
import { fetcher } from '@/lib/api'
import { cn } from '@/lib/utils'

/* ── Central de notificações (sino no header) ──────────────────────────────
   Histórico das notificações emitidas pela conta (GET /api/notifications,
   gravado no fan-out do Web Push). Badge de não lidas = itens mais novos
   que o último "visto" (timestamp em localStorage, por aparelho). */

type NotifItem = {
  id?: string
  at: number
  event: string
  priority?: 'normal' | 'critical'
  title: string
  body: string
  url: string
}

type NotifResponse = { ok: boolean; items: NotifItem[] }

const SEEN_KEY = 'roi:notif-seen'

function lastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

function markSeen() {
  try {
    localStorage.setItem(SEEN_KEY, String(Date.now()))
  } catch {
    /* storage bloqueado: o badge continua — inofensivo */
  }
}

/* Ícone por tipo de evento (mesma taxonomia do notify-copy) */
function EventIcon({ event }: { event: string }) {
  const cls = 'size-3.5 shrink-0'
  switch (event) {
    case 'sale':
    case 'test':
      return <ShoppingCart className={cn(cls, 'text-success')} aria-hidden="true" />
    case 'failed':
      return <CircleX className={cn(cls, 'text-error')} aria-hidden="true" />
    case 'refund':
      return <Undo2 className={cn(cls, 'text-warning')} aria-hidden="true" />
    case 'dispute':
      return <Gavel className={cn(cls, 'text-error')} aria-hidden="true" />
    case 'login':
      return <LogIn className={cn(cls, 'text-brand-cyan')} aria-hidden="true" />
    case 'ads':
    case 'ads_attention':
    case 'ads_rejected':
    case 'ads_proposal':
    case 'ads_failure':
    case 'ads_breaker':
    case 'ads_cap':
      return <Megaphone className={cn(cls, 'text-brand-cyan')} aria-hidden="true" />
    default:
      return <Info className={cn(cls, 'text-muted-foreground')} aria-hidden="true" />
  }
}

/* "há 5 min", "há 2 h", "ontem"… */
function timeAgo(at: number): string {
  const s = Math.max(0, Math.floor((Date.now() - at) / 1000))
  if (s < 60) return 'agora'
  const m = Math.floor(s / 60)
  if (m < 60) return `há ${m} min`
  const h = Math.floor(m / 60)
  if (h < 24) return `há ${h} h`
  const d = Math.floor(h / 24)
  return d === 1 ? 'ontem' : `há ${d} dias`
}

/* Converte o deep link do push (/dashboard/...) para o href do Next
   (basePath /dashboard já é aplicado pelo <Link>). */
function toHref(url: string): string {
  const u = String(url || '/dashboard')
  return u.startsWith('/dashboard') ? u.slice('/dashboard'.length) || '/' : u
}

export function NotificationBell() {
  const { data } = useSWR<NotifResponse>('/api/notifications?limit=12', fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  })
  const [seenAt, setSeenAt] = useState<number>(Number.POSITIVE_INFINITY) // evita flash do badge no SSR
  useEffect(() => {
    setSeenAt(lastSeen())
  }, [])

  const items = data?.items ?? []
  const unread = items.filter((i) => i.at > seenAt).length

  function onOpenChange(open: boolean) {
    if (open) {
      markSeen()
      // badge some ao abrir; a lista continua mostrando tudo
      setSeenAt(Date.now())
    }
  }

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="glass relative flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground"
          aria-label={unread > 0 ? `Notificações — ${unread} não lidas` : 'Notificações'}
        >
          <Bell className="size-3.5" aria-hidden="true" />
          {unread > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--brand-cyan)] px-1 font-mono text-[9px] font-bold leading-none text-[#04141a]"
              aria-hidden="true"
            >
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="glass glass-thick anim-pop-in z-50 w-[min(92vw,320px)] rounded-[12px] p-1.5"
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] px-2.5 pb-2 pt-1">
            <p className="text-xs font-semibold text-foreground">Notificações</p>
            {unread > 0 && <span className="text-[10px] font-medium text-[color:var(--brand-cyan)]">{unread} nova{unread === 1 ? '' : 's'}</span>}
          </div>
          <div className="max-h-[min(60vh,380px)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                Alertas importantes aparecem aqui.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col">
                {items.map((item, idx) => (
                  <li key={item.id || `${item.at}-${idx}`}>
                    <DropdownMenu.Item asChild>
                      <Link
                        href={toHref(item.url)}
                        className={`flex cursor-pointer items-start gap-2.5 rounded-[8px] px-2.5 py-2 outline-none transition-colors data-[highlighted]:bg-[var(--hover)] ${
                          item.priority === 'critical' ? 'bg-destructive/[0.04]' : ''
                        }`}
                      >
                        <span className="mt-0.5">
                          <EventIcon event={item.event} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="truncate text-xs font-medium text-foreground" data-sensitive>
                              {item.title}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] tabular-nums text-faint">
                              {timeAgo(item.at)}
                            </span>
                          </span>
                          {item.body ? (
                            <span className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-muted-foreground" data-sensitive>
                              {item.body}
                            </span>
                          ) : null}
                        </span>
                      </Link>
                    </DropdownMenu.Item>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
