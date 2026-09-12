'use client'

import { useEffect, useId, useRef, useState } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ArrowRight, Bell, ShoppingCart, CircleX, Undo2, Gavel, LogIn, Megaphone, Info } from 'lucide-react'
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
const SEEN_EVENT = 'roi:notifications-seen'
const MAX_VISIBLE_ITEMS = 8

function lastSeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY)) || 0
  } catch {
    return 0
  }
}

function markSeen(at = Date.now()): number {
  try {
    localStorage.setItem(SEEN_KEY, String(at))
    // TopNav e Header montam o mesmo sino em breakpoints diferentes. Sincronizar
    // o estado evita que uma troca de tamanho de tela ressuscite o badge.
    window.dispatchEvent(new CustomEvent(SEEN_EVENT, { detail: at }))
  } catch {
    /* storage bloqueado: o badge continua — inofensivo */
  }
  return at
}

/* Ícone por tipo de evento (mesma taxonomia do notify-copy) */
function EventIcon({ event }: { event: string }) {
  const cls = 'size-3.5 shrink-0'
  switch (event) {
    case 'sale':
    case 'test':
      return <ShoppingCart className={cn(cls, 'text-success')} aria-hidden="true" />
    case 'pix_pending':
      return <ShoppingCart className={cn(cls, 'text-warning')} aria-hidden="true" />
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
    case 'ads_briefing':
    case 'ads_routine':
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
  const [openedSeenAt, setOpenedSeenAt] = useState<number | null>(null)
  const [pulseUnread, setPulseUnread] = useState(false)
  const lastUnreadRef = useRef(0)
  const titleId = useId()

  useEffect(() => {
    setSeenAt(lastSeen())
  }, [])

  useEffect(() => {
    function syncSeen(event: Event) {
      if (event instanceof StorageEvent && event.key !== SEEN_KEY) return
      const next = event instanceof CustomEvent ? Number(event.detail) : lastSeen()
      setSeenAt(Number.isFinite(next) ? next : lastSeen())
    }
    window.addEventListener(SEEN_EVENT, syncSeen)
    window.addEventListener('storage', syncSeen)
    return () => {
      window.removeEventListener(SEEN_EVENT, syncSeen)
      window.removeEventListener('storage', syncSeen)
    }
  }, [])

  const allItems = data?.items ?? []
  const items = allItems.slice(0, MAX_VISIBLE_ITEMS)
  const unread = allItems.filter((i) => i.at > seenAt).length

  useEffect(() => {
    if (!Number.isFinite(seenAt)) return
    if (unread > lastUnreadRef.current) {
      setPulseUnread(true)
      const id = window.setTimeout(() => setPulseUnread(false), 900)
      lastUnreadRef.current = unread
      return () => window.clearTimeout(id)
    }
    lastUnreadRef.current = unread
  }, [unread, seenAt])

  function onOpenChange(open: boolean) {
    if (open) {
      setOpenedSeenAt(lastSeen())
      const now = markSeen()
      // badge some ao abrir; a lista continua mostrando tudo
      setSeenAt(now)
      return
    }
    setOpenedSeenAt(null)
  }

  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'dashboard-account-button dashboard-account-utility dashboard-account-notifications relative flex items-center justify-center text-muted-foreground transition-colors hover:text-foreground',
            unread > 0 && 'dashboard-account-button--has-alert',
          )}
          aria-label={unread > 0 ? `${unread} notificação${unread === 1 ? '' : 'ões'} não lida${unread === 1 ? '' : 's'}` : 'Notificações'}
          title={unread > 0 ? `${unread} notificaç${unread === 1 ? 'ão não lida' : 'ões não lidas'}` : 'Notificações'}
        >
          <Bell className="size-[16px]" aria-hidden="true" />
          {unread > 0 && (
            <span
              className={cn('dashboard-notification-dot', pulseUnread && 'dashboard-notification-dot--pulse')}
              aria-hidden="true"
            />
          )}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          aria-labelledby={titleId}
          className="dashboard-account-popup dashboard-notification-menu glass glass-thick anim-pop-in z-50 w-[min(92vw,336px)] rounded-[14px] p-1.5"
        >
          <div className="dashboard-account-popup__header flex items-center justify-between px-2.5 pb-2 pt-1">
            <p id={titleId} className="text-xs font-semibold text-foreground">Notificações</p>
            {unread > 0 && <span className="dashboard-account-popup__count text-[10px] font-medium">{unread} nova{unread === 1 ? '' : 's'}</span>}
          </div>
          <div className="dashboard-account-popup__body max-h-[min(60vh,380px)] overflow-y-auto overscroll-contain">
            {items.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                Sem alertas por aqui.
              </p>
            ) : (
              <ul className="mt-1 flex flex-col">
                {items.map((item, idx) => {
                  const isUnread = item.at > (openedSeenAt ?? seenAt)
                  return (
                    <li key={item.id || `${item.at}-${idx}`}>
                      <DropdownMenu.Item asChild>
                        <Link
                          href={toHref(item.url)}
                          className={cn(
                            'dashboard-notification-item flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2.5 py-2.5 outline-none transition-colors',
                            isUnread && 'dashboard-notification-item--unread',
                            item.priority === 'critical' && 'dashboard-notification-item--critical',
                          )}
                        >
                          <span className="dashboard-notification-item__icon mt-0.5">
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
                          {isUnread ? <span className="dashboard-notification-item__status" aria-hidden="true" /> : null}
                        </Link>
                      </DropdownMenu.Item>
                    </li>
                  )
                })}
              </ul>
            )}
            {allItems.length > items.length && (
              <div className="dashboard-account-popup__footer mt-1 px-1 pt-1">
                <DropdownMenu.Item asChild>
                  <Link
                    href="/activity"
                    className="dashboard-account-popup__link flex items-center justify-between rounded-[10px] px-2.5 py-2 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground"
                  >
                    Ver atividade
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </DropdownMenu.Item>
              </div>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
