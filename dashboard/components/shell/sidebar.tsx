'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { useHealth } from '@/lib/api'
import { cn } from '@/lib/utils'
import { GestaoHelp } from '@/components/shell/gestao-help'

/** Item 10/208: rodapé com status do sistema + uptime + versão */
function SidebarFooter() {
  const { data: health } = useHealth()
  const ok = health?.db !== false
  const uptime = health?.uptimeSec
    ? health.uptimeSec >= 86_400
      ? `${Math.floor(health.uptimeSec / 86_400)}d`
      : health.uptimeSec >= 3_600
        ? `${Math.floor(health.uptimeSec / 3_600)}h`
        : `${Math.floor(health.uptimeSec / 60)}min`
    : null

  return (
    <div className="mt-auto px-3 pb-5 pt-3">
      <div className="mb-3 h-px bg-border" aria-hidden="true" />
      <div className="flex items-center gap-2 px-3">
        <span
          className={cn('size-1.5 shrink-0 rounded-full', ok ? 'bg-success' : 'bg-error')}
          style={ok ? { boxShadow: '0 0 6px rgba(34,197,94,.6)' } : undefined}
          aria-hidden="true"
        />
        <span className="text-[11px] text-muted-foreground">
          {ok ? 'Operacional' : 'Instável'}
          {uptime ? ` · ${uptime}` : ''}
        </span>
        <span className="ml-auto font-mono text-[10px] text-faint">v2.0</span>
      </div>
    </div>
  )
}

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
      className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[color-mix(in_oklab,var(--bg)_92%,white_2%)] md:flex"
      aria-label="Navegação principal"
    >
      {/* Logo */}
      <div className="flex justify-center px-4 pb-6 pt-8">
        <Link
          href="/"
          className="group"
          aria-label="ROI-NADOS — Visão Geral"
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
      <nav className="flex flex-col gap-5 px-3" aria-label="Seções" data-tour="nav">
        {NAV_SECTIONS.map((section, sIdx) => {
          const sectionActive = section.items.some((item) =>
            item.href === '/' ? pathname === '/' : pathname.startsWith(item.href),
          )
          return (
            <div key={section.title}>
              {/* Item 12: divisória com hairline ciano→transparente */}
              {sIdx > 0 ? <div className="side-section-divider mb-4" aria-hidden="true" /> : null}
              {/* Item 210: label da seção ativa em ciano.
                  Item 59: "?" na seção Gestão abre a visão geral do fluxo. */}
              <p
                className={cn(
                  'mb-2 flex items-center gap-1.5 px-3 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground',
                  sectionActive && 'side-section-label--active',
                )}
              >
                {section.title}
                {section.title === 'Gestão' && <GestaoHelp />}
              </p>
              <ul className="flex flex-col gap-0.5">
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
              </ul>
            </div>
          )
        })}
      </nav>

      <SidebarFooter />
    </aside>
  )
}
