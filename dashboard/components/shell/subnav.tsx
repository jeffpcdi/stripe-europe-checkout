'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeGroup } from '@/lib/navigation'

/** Navegação contextual: aparece apenas quando a seção realmente possui sub-áreas. */
export function SubNav() {
  const pathname = usePathname()
  const group = activeGroup(pathname)

  if (!group.tabs) return null

  return (
    <div className="context-nav-shell" data-tv-hide>
      <nav className="context-nav" aria-label={`Seções de ${group.label}`}>
        {group.tabs.map((tab) => {
          const active = tab.href === '/conversions'
            ? pathname.startsWith('/conversions') || pathname.startsWith('/pixels') || pathname.startsWith('/gateways')
            : pathname === tab.href || pathname.startsWith(tab.href + '/')
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="context-nav__item"
            >
              {tab.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
