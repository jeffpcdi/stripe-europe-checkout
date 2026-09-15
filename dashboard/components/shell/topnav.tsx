'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Menu, X } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { NAV_SECTIONS } from '@/lib/navigation'
import { WorkspaceMenu } from './workspace-menu'

const PRIMARY_LINKS = [
  { label: 'Visão Geral', href: '/', routes: ['/'] },
  { label: 'Rastreamento', href: '/links', routes: ['/links', '/domains', '/cloak', '/pixels', '/conversions', '/gateways'] },
  { label: 'Vendas', href: '/activity', routes: ['/funnel', '/activity'] },
  { label: 'TikTok Ads', href: '/ads/tiktok', routes: ['/ads', '/catalog'] },
]

/** Navegação ampliada; o painel móvel flutua sem deslocar o conteúdo. */
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
          {/* O anexo é JPEG: o enquadramento CSS preserva a arte original. */}
          <Image src="/dashboard/roi-nados-wordmark.jpeg" alt="ROI-NADOS" width={280} height={281}
            sizes="176px" preload className="premium-navbar__wordmark" />
        </Link>
        <span className="premium-navbar__divider" aria-hidden="true" />
        <div className="premium-navbar__workspace"><WorkspaceMenu /></div>
      </div>
      <nav id="dashboard-topnav" className="premium-navbar__navigation" data-open={menuOpen}
        aria-label="Navegação principal" data-tour="nav">
        {PRIMARY_LINKS.map(item => {
          const active = item.routes.some(route => route === '/' ? pathname === '/' : pathname === route || pathname.startsWith(route + '/'))
          return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined}
            className="premium-navbar__tab" onClick={() => setMenuOpen(false)}>{item.label}</Link>
        })}
        <div className="premium-navbar__mobile-extra">
          <WorkspaceMenu />
          {NAV_SECTIONS.flatMap(section => section.items).filter(item => !PRIMARY_LINKS.some(link => link.href === item.href)).map(item => (
            <Link key={item.id} href={item.href} onClick={() => setMenuOpen(false)}
              aria-current={pathname.startsWith(item.href) ? 'page' : undefined}>{item.label}</Link>
          ))}
        </div>
      </nav>
      <div className="premium-navbar__right">
        {children}
        <button ref={toggleRef} type="button" className="premium-navbar__menu premium-navbar__icon"
          aria-label={menuOpen ? 'Fechar menu principal' : 'Abrir menu principal'}
          aria-expanded={menuOpen} aria-controls="dashboard-topnav" onClick={() => setMenuOpen(value => !value)}>
          {menuOpen ? <X size={19} aria-hidden="true" /> : <Menu size={19} aria-hidden="true" />}
        </button>
      </div>
    </header>
  )
}
