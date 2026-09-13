'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, LayoutGrid, ArrowUpRight } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

const ITEMS = NAV_SECTIONS.flatMap(section => section.items)

function TikTokNavIcon({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d="M13.1 4.2v9.35a3.18 3.18 0 1 1-2.28-3.04" fill="none" stroke="#25F4EE" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" transform="translate(-.65 .45)" opacity=".95" />
      <path d="M13.1 4.2c.55 2.15 1.88 3.42 4.02 3.87" fill="none" stroke="#FE2C55" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" transform="translate(.7 -.25)" opacity=".92" />
      <path d="M13.1 4.2v9.35a3.18 3.18 0 1 1-2.28-3.04M13.1 4.2c.55 2.15 1.88 3.42 4.02 3.87" fill="none" stroke="#F8FBFF" strokeWidth="1.72" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Cabeçalho único: marca, contexto da página e navegação sempre reconhecíveis. */
export function TopNav({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const [menuOpen, setMenuOpen] = useState(false)
  const shellRef = useRef<HTMLElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => { setMenuOpen(false) }, [pathname])
  useEffect(() => {
    if (!menuOpen) return
    const outside = (event: PointerEvent) => {
      if (!shellRef.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setMenuOpen(false)
      toggleRef.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [menuOpen])

  return (
    <header ref={shellRef} className="dashboard-masthead" data-tv-hide>
      <Link href="/" className="dashboard-brand-link" aria-label="ROI-NADOS — Visão geral" onClick={() => setMenuOpen(false)}>
        <span className="dashboard-logo-frame">
          <Image src="/dashboard/roi-nados-logo.jpg" alt="ROI-NADOS" width={144} height={144}
            unoptimized priority className="dashboard-logo-image" />
        </span>
      </Link>
      {children}
      <button ref={toggleRef} type="button" className="dashboard-menu-toggle"
        aria-expanded={menuOpen} aria-controls="dashboard-topnav" onClick={() => setMenuOpen(value => !value)}>
        <LayoutGrid size={17} aria-hidden="true" /><span className="dashboard-menu-label">Menu</span><ChevronDown size={15} aria-hidden="true" />
      </button>
      <nav id="dashboard-topnav" className="dashboard-topnav" data-open={menuOpen}
        aria-label="Navegação principal" data-tour="nav">
        {ITEMS.map(item => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
          return (
            <Link key={item.id} href={item.href} aria-current={active ? 'page' : undefined}
              onClick={() => setMenuOpen(false)}
              className={cn('dashboard-nav-link', active && 'dashboard-nav-link--active')}>
              {item.id === 'ads' ? (
                <TikTokNavIcon className="dashboard-tiktok-icon" />
              ) : (
                <item.icon size={18} aria-hidden="true" />
              )}
              <span>{item.label}</span>
              <ArrowUpRight className="dashboard-nav-arrow" size={14} aria-hidden="true" />
            </Link>
          )
        })}
      </nav>
    </header>
  )
}
