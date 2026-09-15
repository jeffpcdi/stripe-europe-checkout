'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogOut, Eye, EyeOff, Settings } from 'lucide-react'
import { useAccount } from '@/lib/api'
import { DurabilityBadge } from './durability-badge'
import { NotificationBell } from './notification-bell'
import { OverviewCalendar } from './overview-calendar'
import { WorkspaceMenu } from './workspace-menu'
import { usePrefs } from '@/lib/prefs'

function UserMenu() {
  const { data: account } = useAccount()
  const { prefs, update } = usePrefs()
  const privateValues = prefs.privacy === 'on'
  const loginUrl = process.env.NEXT_PUBLIC_LOGIN_URL || '/login'

  useEffect(() => {
    function onStorage(event: StorageEvent) {
      if (event.key === 'roi:logout' && event.newValue) window.location.href = loginUrl
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [loginUrl])

  async function logout() {
    await fetch('/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    try { localStorage.setItem('roi:logout', String(Date.now())) } catch { /* Armazenamento indisponível. */ }
    window.location.href = loginUrl
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="premium-navbar__avatar-button" aria-label="Menu da conta">
          <span className="premium-navbar__avatar-ring"><span className="premium-navbar__avatar-crop">
            <Image src="/dashboard/roi-nados-avatar-nav.png" alt="" width={512} height={512} sizes="88px" className="premium-navbar__avatar-image" />
          </span></span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={10} collisionPadding={12} className="premium-navbar-popup premium-navbar-popup--account">
          <DropdownMenu.Label className="premium-navbar-popup__label">
            <span className="block truncate text-foreground text-sm font-medium">{account?.name || 'Conta'}</span>
            <span className="block truncate font-normal">{account?.email}</span>
          </DropdownMenu.Label>
          <DropdownMenu.Separator className="premium-navbar-popup__separator" />
          <DropdownMenu.Item asChild className="premium-navbar-popup__item">
            <Link href="/config"><Settings size={15} aria-hidden="true" />Conta</Link>
          </DropdownMenu.Item>
          <DropdownMenu.CheckboxItem
            checked={privateValues}
            onCheckedChange={checked => update({ privacy: checked ? 'on' : 'off' })}
            className="premium-navbar-popup__item"
          >
            {privateValues ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
            Ocultar valores sensíveis
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="premium-navbar-popup__separator" />
          <DropdownMenu.Item className="premium-navbar-popup__item premium-navbar-popup__item--danger" onSelect={logout}>
            <LogOut size={15} aria-hidden="true" />Sair
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

export function Header() {
  return (
    <div className="premium-navbar__actions">
      <div className="premium-navbar__workspace premium-navbar__workspace--utility"><WorkspaceMenu /></div>
      <OverviewCalendar />
      <div className="premium-navbar__durability"><DurabilityBadge /></div>
      <NotificationBell />
      <UserMenu />
    </div>
  )
}
