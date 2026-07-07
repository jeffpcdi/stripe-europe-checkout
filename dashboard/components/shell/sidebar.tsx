'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Zap } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="glass glass-thick fixed inset-y-3 left-3 z-40 hidden w-60 flex-col overflow-y-auto p-4 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <span
          className="flex size-8 items-center justify-center rounded-[10px] text-background"
          style={{ background: 'var(--brand-grad)' }}
          aria-hidden="true"
        >
          <Zap className="size-4" />
        </span>
        <span className="text-base font-semibold tracking-tight">
          Painel <span className="text-gradient-brand">Pro</span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-5" aria-label="Navegação principal">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname.startsWith(item.href)
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-sm transition-colors duration-150',
                        active
                          ? 'bg-[var(--active)] text-foreground'
                          : 'text-sub hover:bg-[var(--hover)] hover:text-foreground',
                      )}
                    >
                      <item.icon
                        className={cn(
                          'size-4 shrink-0',
                          active ? 'text-brand-cyan' : 'text-muted-foreground',
                        )}
                        aria-hidden="true"
                      />
                      {item.label}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  )
}
