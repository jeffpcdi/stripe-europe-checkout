'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogOut, UserRound, Eye, EyeOff } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/navigation'
import { useAccount } from '@/lib/api'
import { DurabilityBadge } from '@/components/shell/durability-badge'
import { NotificationBell } from '@/components/shell/notification-bell'
import { usePrefs } from '@/lib/prefs'
import { cn } from '@/lib/utils'

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

/** Item 125: modo apresentação — borra receita/valores sensíveis para demos */
function PrivacyButton() {
  const { prefs, update } = usePrefs()
  const on = prefs.privacy === 'on'
  return (
    <button
      type="button"
      onClick={() => update({ privacy: on ? 'off' : 'on' })}
      className={cn(
        'dashboard-account-button',
        on ? 'text-brand-cyan' : 'text-muted-foreground hover:text-foreground',
      )}
      aria-label={on ? 'Mostrar valores sensíveis' : 'Ocultar valores sensíveis'}
      aria-pressed={on}
      title={on ? 'Modo apresentação ativo — valores borrados' : 'Ocultar valores para gravar tela'}
    >
      {on ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
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
  const loginUrl = process.env.NEXT_PUBLIC_LOGIN_URL || '/login'

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
          className="dashboard-account-button dashboard-account-avatar"
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
            {/* Link do Next aplica o basePath /dashboard — <a> cru caía em 404 */}
            <Link href="/config">
              <UserRound className="size-3.5" aria-hidden="true" />
              Configurações
            </Link>
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
      className="dashboard-scroll-progress"
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

  // Item 13: breadcrumb re-anima quando a página troca
  const prevPath = useRef(pathname)
  const changed = prevPath.current !== pathname
  prevPath.current = pathname

  return (
    <>
      <div key={pathname} className={cn('dashboard-page-context', changed && 'anim-fade-in')}>
        <span className="dashboard-page-eyebrow">Seu painel</span>
        <h1>{current.label}</h1>
      </div>
      <div className="dashboard-account-actions">
        <DurabilityBadge />
        <NotificationBell />
        <PrivacyButton />
        <UserMenu />
      </div>
      <ScrollProgress />
    </>
  )
}
