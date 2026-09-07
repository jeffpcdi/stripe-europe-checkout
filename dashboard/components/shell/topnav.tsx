'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MobileNav } from './mobile-nav'
import { NotificationBell } from './notification-bell'

/**
 * Barra superior — visível apenas no mobile.
 * No desktop a navegação vive na Sidebar lateral esquerda.
 */
export function TopNav() {
  return (
    /* V2-81: topnav mobile com hairline gradiente no lugar da borda seca */
    <header className="header-hairline sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden">
      <div className="flex h-16 items-center justify-between gap-3 px-4 pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))]">
        {/* Logo */}
        <Link href="/" className="group flex items-center" aria-label="ROI-NADOS">
          <span className="brand-logo" aria-hidden="true">
            <span className="brand-logo__ring" />
            <Image
              src="/dashboard/roi-nados-logo.jpg"
              alt="ROI-NADOS"
              width={40}
              height={40}
              className="brand-logo__img"
              priority
            />
          </span>
        </Link>

        {/* Direita: status ao vivo + sino + menu */}
        <div className="flex items-center gap-2.5">
          <NotificationBell />
          <MobileNav />
        </div>
      </div>
    </header>
  )
}
