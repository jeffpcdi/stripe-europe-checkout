'use client'

import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { MobileNav } from './mobile-nav'

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

export function Header() {
  const pathname = usePathname()
  const current =
    ALL_ITEMS.find((i) =>
      i.href === '/' ? pathname === '/' : pathname.startsWith(i.href),
    ) ?? ALL_ITEMS[0]

  return (
    <header className="mb-6 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <MobileNav />
        <div>
          <p className="label-mono mb-0.5">
            ROI-NADOS <span className="text-[color:var(--brand-cyan)]">/</span>{' '}
            {current.label}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {current.label}
          </h1>
          <p className="text-sm text-muted-foreground">{current.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="label-mono hidden sm:block" suppressHydrationWarning>
          {DATE_FMT.format(new Date())}
        </span>
        <div className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5">
          <span className="live-dot" aria-hidden="true" />
          <span className="text-xs font-medium text-sub">Ao vivo</span>
        </div>
      </div>
    </header>
  )
}
