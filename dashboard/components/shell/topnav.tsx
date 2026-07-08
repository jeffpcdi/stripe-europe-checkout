'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_GROUPS, activeGroup } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { MobileNav } from './mobile-nav'

export function TopNav() {
  const pathname = usePathname()
  const current = activeGroup(pathname)

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_88%,transparent)] backdrop-blur-md">
      <div className="relative flex h-16 items-center justify-between gap-3 px-4 lg:px-6">
        {/* Logo */}
        <Link href="/" className="group flex items-center" aria-label="ROI-NADOS">
          <span className="brand-logo" aria-hidden="true">
            <span className="brand-logo__ring" />
            <Image
              src="/roi-nados-logo.jpg"
              alt="ROI-NADOS"
              width={40}
              height={40}
              className="brand-logo__img"
              priority
            />
          </span>
        </Link>

        {/* Pills centralizadas — identidade do legado */}
        <nav
          className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-2 md:flex"
          aria-label="Navegação principal"
        >
          {NAV_GROUPS.map((group) => {
            const active = group.id === current.id
            return (
              <Link
                key={group.id}
                href={group.href}
                aria-current={active ? 'page' : undefined}
                className={cn('nav-pill', active && 'nav-pill--active')}
              >
                <group.icon className="size-4" aria-hidden="true" />
                {group.label}
              </Link>
            )
          })}
        </nav>

        {/* Direita: status ao vivo + menu mobile */}
        <div className="flex items-center gap-3">
          <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5">
            <span className="live-dot" aria-hidden="true" />
            <span className="text-xs font-medium text-sub">Ao vivo</span>
          </div>
          <div className="md:hidden">
            <MobileNav />
          </div>
        </div>
      </div>
    </header>
  )
}
