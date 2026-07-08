'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * Sidebar lateral esquerda — identidade do dashboard legado:
 * logo neon no topo, seções (Métricas / Gestão / Sistema) e
 * item ativo com barra ciano à esquerda.
 */
export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_92%,white_2%)] md:flex"
      aria-label="Navegação principal"
    >
      {/* Logo */}
      <div className="flex justify-center px-4 pb-6 pt-8">
        <Link href="/" className="group" aria-label="ROI-NADOS — Visão Geral">
          <span className="brand-logo brand-logo--lg" aria-hidden="true">
            <span className="brand-logo__ring" />
            <Image
              src="/dashboard/roi-nados-logo.jpg"
              alt="ROI-NADOS"
              width={104}
              height={104}
              className="brand-logo__img"
              priority
            />
          </span>
        </Link>
      </div>

      {/* Seções de navegação */}
      <nav className="flex flex-1 flex-col gap-6 px-3 pb-8">
        {NAV_SECTIONS.map((section) => (
          <div key={section.title}>
            <p className="mb-2 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
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
                      className={cn('side-item', active && 'side-item--active')}
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
