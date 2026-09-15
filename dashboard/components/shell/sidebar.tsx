'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

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
      <div className="relative flex flex-col items-start justify-center px-5 py-7 overflow-hidden">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(37,244,238,0.10)_0%,rgba(254,44,85,0.04)_42%,transparent_72%)]" aria-hidden="true" />
        <Link href="/" className="group relative z-10 flex items-center focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-4" aria-label="ROI-NADOS — Visão geral">
          <Image src="/dashboard/roi-nados-wordmark.jpeg" alt="ROI-NADOS" width={720} height={180} priority className="h-10 w-auto object-contain transition-transform duration-300 group-hover:scale-[1.02]" />
        </Link>
        <div className="absolute bottom-0 left-5 right-5 h-px bg-gradient-to-r from-transparent via-brand-cyan/30 to-transparent" aria-hidden="true" />
      </div>

      <nav className="flex flex-col gap-4 px-3 pt-2 pb-6" aria-label="Seções" data-tour="nav">
        {NAV_SECTIONS.map((section, sIdx) => (
          <div key={section.title} className={cn(sIdx > 0 && 'border-t border-white/[0.04] pt-3')}>
            <p className="mb-1.5 px-3 text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">{section.title}</p>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
                const delay = itemIndex++ * 35
                return (
                  <li key={item.id}>
                    <Link
                      href={item.href}
                      aria-current={active ? 'page' : undefined}
                      className={cn('side-item group', active && 'side-item--active', enterAnim && 'side-item--enter')}
                      style={enterAnim ? { animationDelay: `${delay}ms` } : undefined}
                    >
                      <item.icon className={cn('size-4 shrink-0 transition-transform duration-200 group-hover:scale-110', active ? 'text-brand-cyan drop-shadow-[0_0_6px_rgba(37,244,238,0.5)]' : 'text-muted-foreground/70 group-hover:text-foreground')} aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                      {active && <span className="ml-auto size-1.5 rounded-full bg-brand-cyan shadow-[0_0_6px_var(--accent)]" />}
                      <span className="side-item__tip" role="presentation" aria-hidden="true">
                        <span className="block text-xs font-semibold text-foreground">{item.label}</span>
                        <span className="block text-[11px] text-muted-foreground">{item.description}</span>
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
