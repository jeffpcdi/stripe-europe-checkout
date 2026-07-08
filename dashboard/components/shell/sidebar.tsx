'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="glass glass-thick fixed inset-y-3 left-3 z-40 hidden w-60 flex-col overflow-y-auto p-4 lg:flex">
      {/* Marca ROI-NADOS */}
      <Link
        href="/"
        className="group mb-6 flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-[var(--hover)]"
      >
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
        <span className="flex flex-col leading-tight">
          <span className="text-[15px] font-bold tracking-tight text-foreground">
            ROI<span className="text-gradient-brand">-NADOS</span>
          </span>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-faint">
            Performance Hub
          </span>
        </span>
      </Link>

      <nav className="flex flex-1 flex-col gap-5" aria-label="Navegação principal">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-faint">
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
                        'group relative flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-sm transition-all duration-200',
                        active
                          ? 'bg-[var(--active)] text-foreground'
                          : 'text-sub hover:bg-[var(--hover)] hover:text-foreground hover:translate-x-0.5',
                      )}
                    >
                      {/* Indicador ativo — barra de marca com glow */}
                      <span
                        className={cn(
                          'absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full transition-all duration-300',
                          active
                            ? 'scale-y-100 opacity-100'
                            : 'scale-y-0 opacity-0',
                        )}
                        style={{
                          background: 'var(--brand-grad)',
                          boxShadow: active ? '0 0 10px rgba(37,244,238,0.7)' : 'none',
                        }}
                        aria-hidden="true"
                      />
                      <item.icon
                        className={cn(
                          'size-4 shrink-0 transition-colors duration-200',
                          active
                            ? 'text-brand-cyan'
                            : 'text-muted-foreground group-hover:text-foreground',
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
