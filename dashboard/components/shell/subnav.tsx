'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { activeGroup } from '@/lib/navigation'

export function SubNav() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const group = activeGroup(pathname)

  if (!group.tabs) return null

  return (
    <div className="context-nav-shell" data-tv-hide>
      <nav className="context-nav" aria-label={`Seções de ${group.label}`}>
        {group.tabs.map((tab) => {
          const [tabPath, tabQuery = ''] = tab.href.split('?')
          let active = false

          if (group.id === 'insights') {
            const expected = new URLSearchParams(tabQuery).get('tab') || 'performance'
            const current = searchParams.get('tab') || 'performance'
            active = pathname === '/insights' && current === expected
          } else if (tab.href === '/conversions') {
            active = pathname.startsWith('/conversions') || pathname.startsWith('/pixels') || pathname.startsWith('/gateways')
          } else {
            active = pathname === tabPath || pathname.startsWith(tabPath + '/')
          }

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
