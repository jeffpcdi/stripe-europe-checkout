'use client'

import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'

const ALL_ITEMS = NAV_SECTIONS.flatMap((s) => s.items)

const DATE_FMT = new Intl.DateTimeFormat('pt-BR', {
  weekday: 'short',
  day: '2-digit',
  month: 'short',
  timeZone: 'America/Sao_Paulo',
})

export function Header() {
  const pathname = usePathname()
  const current =
    ALL_ITEMS.find((i) =>
      i.href === '/' ? pathname === '/' : pathname.startsWith(i.href),
    ) ?? ALL_ITEMS[0]

  return (
    <div className="border-b border-[var(--border)]">
      <div className="flex items-end justify-between gap-4 px-4 py-4 lg:px-6">
        <div className="anim-row-in">
          <h1 className="text-xl font-semibold tracking-tight text-balance">
            {current.label}
          </h1>
          <p className="mt-0.5 text-[12px] text-faint">{current.description}</p>
        </div>
        {/* Item 119: abaixo de 1100px a data empilha sobre o badge para não colidir */}
<div className="flex items-center gap-3 pb-0.5 max-[1100px]:flex-col max-[1100px]:items-end max-[1100px]:gap-1">
          <span className="label-mono hidden sm:block" suppressHydrationWarning>
            {DATE_FMT.format(new Date())}
          </span>
          <div className="glass hidden items-center gap-2 rounded-full px-3.5 py-1.5 md:flex">
            <span className="live-dot" aria-hidden="true" />
            <span className="text-xs font-medium text-sub">Ao vivo</span>
          </div>
        </div>
      </div>
    </div>
  )
}
