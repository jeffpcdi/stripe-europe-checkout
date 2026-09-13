'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Expõe a seção no <html> para acentos contextuais dos componentes.
// O fundo compartilhado é neutro e não muda de cor durante a navegação.
export function SectionAttr() {
  const pathname = usePathname() || ''

  useEffect(() => {
    if (!pathname) return
    const section = pathname === '/'
      ? 'overview'
      : pathname.startsWith('/ads') || pathname.startsWith('/catalog')
        ? 'ads'
        : pathname.startsWith('/conversions') || pathname.startsWith('/pixels') || pathname.startsWith('/gateways')
          ? 'conversions'
          : pathname.startsWith('/links')
            ? 'links'
            : pathname.startsWith('/domains')
              ? 'domains'
              : pathname.startsWith('/cloak')
                ? 'cloak'
                : pathname.startsWith('/config')
                  ? 'config'
                  : pathname.startsWith('/activity')
                    ? 'activity'
                    : pathname.startsWith('/funnel')
                      ? 'funnel'
                      : 'default'
    document.documentElement.dataset.section = section
  }, [pathname])

  // Bloco S: aplica preferências visuais salvas (densidade/animações/
  // privacidade) no boot de qualquer página, antes do usuário abrir Config.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('roi:prefs')
      if (!raw) return
      const prefs = JSON.parse(raw) as Record<string, string>
      const el = document.documentElement
      if (prefs.density) el.dataset.density = prefs.density
      if (prefs.anim) el.dataset.anim = prefs.anim
      if (prefs.privacy) el.dataset.privacy = prefs.privacy
    } catch {
      /* prefs corrompidas — ignora */
    }
  }, [])

  // A atmosfera suspende o movimento quando a aba fica oculta.
  useEffect(() => {
    const syncVisibility = () => {
      document.documentElement.dataset.pageHidden = String(document.hidden)
    }
    syncVisibility()
    document.addEventListener('visibilitychange', syncVisibility)
    return () => {
      document.removeEventListener('visibilitychange', syncVisibility)
      delete document.documentElement.dataset.pageHidden
    }
  }, [])

  return null
}
