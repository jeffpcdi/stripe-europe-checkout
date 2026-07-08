'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

// Item 5: expõe a seção atual como atributo no <html> para o fundo
// aurora mudar de cor por página (ciano padrão, rosa no Ao Vivo,
// âmbar na Geografia) — só CSS reage, sem re-render do fundo.
export function SectionAttr() {
  const pathname = usePathname()

  useEffect(() => {
    const section = pathname.startsWith('/live')
      ? 'live'
      : pathname.startsWith('/geo')
        ? 'geo'
        : 'default'
    document.documentElement.dataset.section = section
  }, [pathname])

  return null
}
