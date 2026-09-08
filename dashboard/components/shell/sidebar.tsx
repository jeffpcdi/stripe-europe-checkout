'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

/**
 * Sidebar lateral esquerda — navegação principal da dashboard:
 * Logo neon no topo, seções organizadas com tipografia refinada e
 * indicador ativo integrado.
 */
export function Sidebar() {
  const pathname = usePathname()
  const [enterAnim, setEnterAnim] = useState(true)

  useEffect(() => {
    const t = window.setTimeout(() => setEnterAnim(false), 1400)
    return () => window.clearTimeout(t)
  }, [])

  let itemIndex = 0

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-background/95 backdrop-blur-xl md:flex selection:bg-brand-cyan/20"
      aria-label="Navegação principal"
    >
      {/* Logo & Brand Header */}
      <div className="flex flex-col items-center justify-center px-4 py-5 border-b border-white/[0.04]">
        <Link
          href="/"
          className="group flex flex-col items-center text-center focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4"
          aria-label="ROI-NADOS — Visão geral"
        >
          <span className="brand-logo brand-logo--lg" aria-hidden="true">
            <span className="brand-logo__ring" />
            <Image
              src="/dashboard/roi-nados-logo.jpg"
              alt="ROI-NADOS"
              width={88}
              height={88}
              unoptimized
              className="brand-logo__img transition-transform duration-300 group-hover:scale-105"
              priority
            />
          </span>
        </Link>
      </div>

      {/* Seções de navegação */}
      <nav className="flex flex-col gap-4 px-3 pt-2 pb-6" aria-label="Seções" data-tour="nav">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title} className={cn(sIdx > 0 && 'border-t border-white/[0.04] pt-3')}>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
              {section.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active =
                  item.href === '/'
                    ? pathname === '/'
                    : pathname.startsWith(item.href)
                const delay = itemIndex++ * 35

                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'side-item group',
                        active && 'side-item--active',
                        enterAnim && 'side-item--enter',
                      )}
                      style={enterAnim ? { animationDelay: `${delay}ms` } : undefined}
                    >
                      <item.icon
                        className={cn(
                          'size-4 shrink-0 transition-transform duration-200 group-hover:scale-110',
                          active ? 'text-brand-cyan drop-shadow-[0_0_6px_rgba(37,244,238,0.5)]' : 'text-muted-foreground/70 group-hover:text-foreground',
                        )}
                        aria-hidden="true"
                      />
                      <span className="truncate">{item.label}</span>

                      {active && (
                        <span className="ml-auto size-1.5 rounded-full bg-brand-cyan shadow-[0_0_6px_var(--accent)]" />
                      )}

                      {/* Tooltip com nome + descrição (desktop) */}
                      <span className="side-item__tip" role="presentation" aria-hidden="true">
                        <span className="block text-xs font-semibold text-foreground">
                          {item.label}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {item.description}
                        </span>
                      </span>
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
