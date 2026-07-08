'use client'

import { usePathname } from 'next/navigation'
import { NAV_SECTIONS, activeGroup } from '@/lib/navigation'

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
})

export function Header() {
  const pathname = usePathname()
  const group = activeGroup(pathname)
  const current =
    ALL_ITEMS.find((i) =>
      i.href === '/' ? pathname === '/' : pathname.startsWith(i.href),
    ) ?? ALL_ITEMS[0]

  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-end justify-between gap-4 px-4 py-4 lg:px-6">
        <div className="anim-row-in">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {group.label}
          </h1>
          <p className="mt-0.5 text-[12px] text-faint">
            {group.label === current.label
              ? current.description
              : `${group.label} · ${current.label}`}
          </p>
        </div>
        <span className="label-mono hidden pb-1 sm:block" suppressHydrationWarning>
          {DATE_FMT.format(new Date())}
        </span>
      </div>
    </div>
  )
}
