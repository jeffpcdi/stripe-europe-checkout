'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useSWRConfig } from 'swr'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { RefreshCw, LogOut, UserRound, Eye, EyeOff } from 'lucide-react'
import { NAV_SECTIONS, activeGroup } from '@/lib/navigation'
import { useAccount, useHealth, useStats } from '@/lib/api'
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

// Item 390: sem segundos por padrão (menos ruído visual); o clique no relógio
// alterna para o formatador com segundos abaixo.
const TIME_FMT = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
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
// Item 390: formatador com segundos, ativado por clique no relógio (pref
// persistida). Sem segundos o intervalo continua 1s — barato e simples.
const TIME_FMT_SECONDS = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'America/Sao_Paulo',
})

function LiveClock() {
  const { prefs, update } = usePrefs()
  const withSeconds = prefs.clockSeconds === 'on'
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])
  return (
    <button
      type="button"
      onClick={() => update({ clockSeconds: withSeconds ? 'off' : 'on' })}
      className="label-mono cursor-pointer tabular-nums transition-colors hover:text-foreground"
      title={withSeconds ? 'Ocultar segundos' : 'Mostrar segundos'}
      aria-pressed={withSeconds}
      suppressHydrationWarning
    >
      {DATE_FMT.format(now ?? new Date())}
      {now ? ` · ${(withSeconds ? TIME_FMT_SECONDS : TIME_FMT).format(now)}` : ''}
    </button>
  )
}

/** Itens 15/198: badge "Ao vivo" — cor pela saúde, hover mostra latência */
function LiveBadge() {
  const { data: health } = useHealth()
  const latency = health?.dbLatencyMs
  const ok = health ? health.db : true
  const slow = ok && typeof latency === 'number' && latency > 500

  // Item 293: contador "próxima atualização em Xs" (hover). O /api/stats
  // atualiza a cada 12s (POLL_MS); reancoramos o ciclo quando chega resposta
  // nova e um tick de 1s (só com hover ativo? não — é barato) mostra o resto.
  const { data: stats } = useStats()
  const anchorRef = useRef(Date.now())
  const [, forceTick] = useState(0)
  useEffect(() => {
    anchorRef.current = Date.now()
  }, [stats])
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const nextIn = Math.max(0, Math.ceil((12_000 - (Date.now() - anchorRef.current)) / 1000))

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
      <span className="hidden font-mono text-[10px] tabular-nums text-faint group-hover/badge:inline">
        {typeof latency === 'number' ? `${latency}ms · ` : ''}
        {ok ? `atualiza em ${nextIn}s` : ''}
      </span>
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

  // Item 405: logout sincronizado entre abas. localStorage dispara `storage`
  // em TODAS as outras abas do mesmo origin — quem receber vai pro login
  // (a sessão já morreu no servidor; ficar na tela só geraria 401 confusos).
  const loginUrl = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === 'roi:logout' && e.newValue) window.location.href = loginUrl
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function logout() {
    await fetch('/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    try {
      localStorage.setItem('roi:logout', String(Date.now()))
    } catch {
      /* storage cheio/bloqueado: as outras abas caem no guard de 401 */
    }
    window.location.href = loginUrl
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
        <div key={pathname} className={cn(changed && 'anim-blur-in')}>
          {/* V2-72: saudação com gradiente da marca no eyebrow */}
          <p className="label-mono label-mono--gradient mb-0.5 text-[11px]">
            {greeting()}
            {group.label !== current.label ? ` · ${group.label}` : ''}
          </p>
          {/* V2-73: título da página entra com blur-in (foco progressivo) */}
          <h1 className="h1-gradient text-xl font-semibold tracking-tight text-balance">
            {current.label}
          </h1>
          <p className="mt-0.5 text-[12px] text-pretty text-faint">{current.description}</p>
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
