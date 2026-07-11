'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSWRConfig } from 'swr'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { RefreshCw, LogOut, UserRound, Eye, EyeOff } from 'lucide-react'
import { NAV_SECTIONS, activeGroup } from '@/lib/navigation'
import { useAccount, useHealth } from '@/lib/api'
import { DurabilityBadge } from '@/components/shell/durability-badge'
import { usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/utils'

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
})

const TIME_FMT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

/** Item 195: saudação conforme hora de Brasília */
function greeting(): string {
  const hour = Number(
    new Intl.DateTimeFormat('pt-BR', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' })
      .format(new Date()),
  )
  if (hour >= 5 && hour < 12) return 'Bom dia'
  if (hour >= 12 && hour < 18) return 'Boa tarde'
  return 'Boa noite'
}

/** Item 14: relógio ao vivo HH:MM:SS mono (atualiza a cada segundo) */
function LiveClock() {
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <span className="label-mono tabular-nums" suppressHydrationWarning>
      {DATE_FMT.format(now ?? new Date())}
      {now ? ` · ${TIME_FMT.format(now)}` : ''}
    </span>
  )
}

/** Itens 15/198: badge "Ao vivo" — cor pela saúde, hover mostra latência */
function LiveBadge() {
  const { data: health } = useHealth()
  const latency = health?.dbLatencyMs
  const ok = health ? health.db : true
  const slow = ok && typeof latency === 'number' && latency > 500
  return (
    <div
      className="group/badge glass hidden items-center gap-2 rounded-full px-3.5 py-1.5 md:flex"
      title={typeof latency === 'number' ? `Latência do banco: ${latency}ms` : undefined}
      data-tour="live-badge"
    >
      <span
        className={cn('live-dot', !ok && '[--success:var(--error)]', slow && '[--success:var(--warning)]')}
        aria-hidden="true"
      />
      <span className="text-xs font-medium text-sub">
        {ok ? 'Ao vivo' : 'Reconectando'}
      </span>
      {typeof latency === 'number' ? (
        <span className="hidden font-mono text-[10px] tabular-nums text-faint group-hover/badge:inline">
          {latency}ms
        </span>
      ) : null}
    </div>
  )
}

/** Item 197: refresh manual — revalida todos os SWR, ícone gira durante o fetch */
function RefreshButton() {
  const { mutate } = useSWRConfig()
  const [busy, setBusy] = useState(false)
  const [lastAt, setLastAt] = useState<Date | null>(null)

  async function refresh() {
    setBusy(true)
    try {
      await mutate(() => true, undefined, { revalidate: true })
      setLastAt(new Date())
    } finally {
      setTimeout(() => setBusy(false), 400)
    }
  }

  return (
    <button
      type="button"
      onClick={refresh}
      className="glass hidden size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground sm:flex"
      aria-label="Atualizar dados"
      title={lastAt ? `Atualizado às ${TIME_FMT.format(lastAt)}` : 'Atualizar dados'}
    >
      <RefreshCw className={cn('size-3.5', busy && 'animate-spin')} aria-hidden="true" />
    </button>
  )
}

/** Item 125: modo apresentação — borra receita/valores sensíveis para demos */
function PrivacyButton() {
  const { prefs, update } = usePrefs()
  const on = prefs.privacy === 'on'
  return (
    <button
      type="button"
      onClick={() => update({ privacy: on ? 'off' : 'on' })}
      className={cn(
        'glass hidden size-8 items-center justify-center rounded-full transition-colors sm:flex',
        on ? 'text-brand-cyan' : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={on ? 'Mostrar valores sensíveis' : 'Ocultar valores sensíveis'}
      aria-pressed={on}
      title={on ? 'Modo apresentação ativo — valores borrados' : 'Ocultar valores para gravar tela'}
    >
      {on ? <EyeOff className="size-3.5" aria-hidden="true" /> : <Eye className="size-3.5" aria-hidden="true" />}
    </button>
  )
}

/** Item 199: menu do usuário com avatar de inicial + sair */
function UserMenu() {
  const { data: account } = useAccount()
  const initial = (account?.name || account?.email || '?').charAt(0).toUpperCase()

  async function logout() {
    await fetch('/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    window.location.href = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="glass hidden size-8 items-center justify-center rounded-full text-xs font-bold text-brand-cyan transition-transform hover:scale-105 sm:flex"
          aria-label="Menu do usuário"
        >
          {initial}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="glass glass-thick anim-pop-in z-50 min-w-44 rounded-[12px] p-1.5"
        >
          <div className="border-b border-[var(--border)] px-2.5 pb-2 pt-1">
            <p className="truncate text-xs font-semibold text-foreground">
              {account?.name || 'Conta'}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">{account?.email}</p>
          </div>
          <DropdownMenu.Item
            className="mt-1 flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-sub outline-none transition-colors data-[highlighted]:bg-[var(--hover)] data-[highlighted]:text-foreground"
            asChild
          >
            <a href="/config">
              <UserRound className="size-3.5" aria-hidden="true" />
              Configurações
            </a>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-[8px] px-2.5 py-2 text-xs text-error outline-none transition-colors data-[highlighted]:bg-[var(--error-light)]"
            onSelect={logout}
          >
            <LogOut className="size-3.5" aria-hidden="true" />
            Sair
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** Item 200: hairline ciano no rodapé do header indicando progresso de scroll */
function ScrollProgress() {
  const [pct, setPct] = useState(0)
  useEffect(() => {
    function onScroll() {
      const el = document.documentElement
      const max = el.scrollHeight - el.clientHeight
      setPct(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute bottom-0 left-0 h-px bg-[var(--accent)] transition-[width] duration-150"
      style={{ width: `${pct}%`, opacity: pct > 0 ? 0.7 : 0 }}
    />
  )
}

export function Header() {
  const pathname = usePathname()
  const current =
    ALL_ITEMS.find((i) =>
      i.href === '/' ? pathname === '/' : pathname.startsWith(i.href),
    ) ?? ALL_ITEMS[0]
  const group = activeGroup(pathname)

  // Item 13: breadcrumb re-anima quando a página troca
  const prevPath = useRef(pathname)
  const changed = prevPath.current !== pathname
  prevPath.current = pathname

  return (
    <div className="relative border-b border-[var(--border)]">
      {/* Item 16: sheen lento no hairline inferior */}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-px overflow-hidden"
      >
        <span
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent, rgba(37,244,238,.5), transparent)',
            animation: 'hairlineSheen 8s var(--ease) infinite',
          }}
        />
      </span>

      <div className="flex items-end justify-between gap-4 px-4 py-4 lg:px-6">
        <div key={pathname} className={cn(changed && 'anim-row-in')}>
          {/* Itens 13/195: saudação + breadcrumb Seção / Página */}
          <p className="label-mono mb-0.5 text-[11px]">
            {greeting()}
            {group.label !== current.label ? ` · ${group.label}` : ''}
          </p>
          {/* Item 91: H1 com gradiente branco→ciano sutil */}
          <h1 className="h1-gradient text-xl font-semibold tracking-tight text-balance">
            {current.label}
          </h1>
          <p className="mt-0.5 text-[12px] text-faint">{current.description}</p>
        </div>
        {/* Item 119: abaixo de 1100px a data empilha para não colidir */}
        <div className="flex items-center gap-3 pb-0.5 max-[1100px]:flex-col max-[1100px]:items-end max-[1100px]:gap-1.5">
          <span className="hidden sm:block">
            <LiveClock />
          </span>
          <div className="flex items-center gap-2">
            {/* Item 186: alerta global de durabilidade (só aparece se o banco cair) */}
            <DurabilityBadge />
            <PrivacyButton />
            <RefreshButton />
            <LiveBadge />
            <UserMenu />
          </div>
        </div>
      </div>

      <ScrollProgress />
    </div>
  )
}
