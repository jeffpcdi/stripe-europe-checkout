'use client'

import Link from 'next/link'
import Image from 'next/image'
import { MobileNav } from './mobile-nav'

/**
 * Barra superior — visível apenas no mobile.
 * No desktop a navegação vive na Sidebar lateral esquerda.
 */
export function TopNav() {
  return (
    /* V2-81: topnav mobile com hairline gradiente no lugar da borda seca */
    <header className="header-hairline sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md md:hidden">
      <div className="flex h-16 items-center justify-between gap-3 px-4">
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

        {/* Direita: status ao vivo + menu */}
        <div className="flex items-center gap-3">
          <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5">
            <span className="live-dot" aria-hidden="true" />
            <span className="text-xs font-medium text-sub">Ao vivo</span>
          </div>
          <MobileNav />
        </div>
      </div>
    </header>
  )
}
