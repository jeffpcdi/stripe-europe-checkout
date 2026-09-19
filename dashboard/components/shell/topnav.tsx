'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_GROUPS } from '@/lib/navigation'

const PRIMARY_LINKS = NAV_GROUPS
  .filter((group) => group.id === 'overview' || group.id === 'insights' || group.id === 'tracking' || group.id === 'ads')
  .map((group) => ({ label: group.label, href: group.href, routes: group.routes }))

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
      if (event.key !== 'Escape' || event.defaultPrevented) return
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
    <header ref={shellRef} className="premium-navbar" data-tv-hide>
      <div className="premium-navbar__identity">
        <Link href="/" className="premium-navbar__brand" aria-label="ROI-NADOS — Visão geral" onClick={() => setMenuOpen(false)}>
          <Image
            src="/dashboard/roi-nados-wordmark-ui.png"
            alt="ROI-NADOS"
            width={860}
            height={257}
            sizes="180px"
            preload
            className="premium-navbar__wordmark"
          />
          <Image
            src="/dashboard/roi-nados-appmark.png"
            alt=""
            width={321}
            height={257}
            sizes="44px"
            aria-hidden="true"
            className="premium-navbar__appmark"
          />
        </Link>
      </div>

      <div className="premium-navbar__center">
        <nav
          id="dashboard-topnav"
          className="premium-navbar__navigation"
          data-open={menuOpen}
          aria-label="Navegação principal"
          data-tour="nav"
        >
          {PRIMARY_LINKS.map(item => {
            const active = item.routes.some(route => route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(route + '/'))
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className="premium-navbar__tab"
                onClick={() => setMenuOpen(false)}
              >
                {item.label}
              </Link>
            )
          })}
          <div className="premium-navbar__mobile-extra">
            <Link
              href="/config"
              onClick={() => setMenuOpen(false)}
              aria-current={pathname.startsWith('/config') ? 'page' : undefined}
            >
              Conta
            </Link>
          </div>
        </nav>
      </div>

      <div className="premium-navbar__right">
        {children}
        <button
          ref={toggleRef}
          type="button"
          className="premium-navbar__menu premium-navbar__icon"
          aria-label={menuOpen ? 'Fechar menu principal' : 'Abrir menu principal'}
          aria-expanded={menuOpen}
          aria-controls="dashboard-topnav"
          onClick={() => setMenuOpen(value => !value)}
        >
          {menuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
