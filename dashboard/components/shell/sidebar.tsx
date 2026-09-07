'use client'

import { useEffect, useState } from 'react'
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
  // Stagger discreto só no primeiro load (não repete em navegação).
  // Estado (não ref mutada no render) para SSR e hidratação renderizarem
  // igual; um timeout remove a classe após a animação terminar.
  const [enterAnim, setEnterAnim] = useState(true)
  useEffect(() => {
    const t = window.setTimeout(() => setEnterAnim(false), 1400)
    return () => window.clearTimeout(t)
  }, [])

  let itemIndex = 0

  return (
    <aside
      className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col overflow-y-auto border-r border-white/5 bg-background md:flex"
      aria-label="Navegação principal"
    >
      {/* Logo */}
      <div className="flex justify-center px-4 pb-5 pt-5">
        <Link
          href="/"
          className="group"
          aria-label="ROI-NADOS — Visão geral"
        >
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
      <nav className="flex flex-col gap-1 px-3" aria-label="Seções" data-tour="nav">
        <div className="space-y-5">
          {NAV_SECTIONS.map(section => <div key={section.title}>
          <p className="mb-2 px-3 text-[11px] font-medium text-muted-foreground">{section.title}</p>
          <ul className="flex flex-col gap-1">
          {section.items.map((item) => {
            const active =
              item.href === '/'
                ? pathname === '/'
                : pathname.startsWith(item.href)
            const delay = itemIndex++ * 40
            return (
              <li key={item.id}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'side-item',
                    active && 'side-item--active',
                    enterAnim && 'side-item--enter',
                  )}
                  style={enterAnim ? { animationDelay: `${delay}ms` } : undefined}
                >
                  <item.icon
                    className={cn(
                      'size-4 shrink-0',
                      active ? 'text-brand-cyan' : 'text-muted-foreground',
                    )}
                    aria-hidden="true"
                  />
                  {item.label}
                  {/* Tooltip com nome + descrição */}
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
          </ul></div>)}
        </div>
      </nav>
    </aside>
  )
}
