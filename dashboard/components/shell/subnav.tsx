'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeGroup } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * Faixa de sub-abas centralizada — réplica das abas do "Rastreamento"
 * do dashboard legado (Links de Checkout · Filtro de Bots · ...).
 */
export function SubNav() {
  const pathname = usePathname()
  const group = activeGroup(pathname)

  if (!group.tabs) return null

  return (
    <nav
      className="anim-row-in mb-6 flex justify-center"
      aria-label={`Seções de ${group.label}`}
    >
      <div className="glass flex max-w-full items-center gap-1 overflow-x-auto rounded-[12px] p-1">
        {group.tabs.map((tab) => {
          const active = pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap rounded-[9px] px-3.5 py-1.5 text-[13px] font-medium transition-all duration-150',
                active
                  ? 'bg-[var(--active)] text-foreground shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]'
                  : 'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
              )}
            >
              {tab.label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
