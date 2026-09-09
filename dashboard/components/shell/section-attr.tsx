'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Item 5: expõe a seção atual como atributo no <html> para o fundo
// aurora mudar de cor por página (ciano padrão, rosa no Ao Vivo,
// âmbar na Geografia) — só CSS reage, sem re-render do fundo.
export function SectionAttr() {
  const pathname = usePathname() || ''

  useEffect(() => {
    if (!pathname) return
    const section = pathname.startsWith('/live')
      ? 'live'
      : pathname.startsWith('/geo')
        ? 'geo'
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

  return null
}
