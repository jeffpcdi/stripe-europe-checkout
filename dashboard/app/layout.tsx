import type { Metadata, Viewport } from 'next'
import { SectionAttr } from '@/components/shell/section-attr'
import './globals.css'

export const metadata: Metadata = {
  title: 'ROI-NADOS — Tracking & Conversões',
  description: 'Painel de métricas, conversões e pixels em tempo real',
  // PWA/iOS: ícone da Tela de Início e modo standalone (requisito p/ Web Push no iPhone)
  appleWebApp: {
    capable: true,
    title: 'ROI-NADOS',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    // basePath /dashboard não é aplicado automaticamente em metadata.icons
    icon: '/dashboard/icon-192.png',
    apple: '/dashboard/apple-touch-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#08080a',
  colorScheme: 'dark',
  // iPhone com Dynamic Island/notch: ocupa a tela toda e expõe as variáveis
  // env(safe-area-inset-*) usadas no topnav, mobile-nav e toaster.
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="pt-BR"
      // V2-99: informa o Next que o smooth scroll é intencional (evita warning)
      data-scroll-behavior="smooth"
      className="bg-background"
    >
      <body className="font-sans antialiased">
        <SectionAttr />
        <div className="app-bg" aria-hidden="true">
          <div className="app-bg__dots" />
          <div className="app-bg__aurora" />
          <div className="app-bg__vignette" />
          <div className="app-bg__grain" />
        </div>
        {children}
      </body>
    </html>
  )
}
