import type { Metadata, Viewport } from 'next'
import { Inter, Geist_Mono } from 'next/font/google'
import { SectionAttr } from '@/components/shell/section-attr'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

const geistMono = Geist_Mono({
  subsets: ['latin'],
  variable: '--font-geist-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'ROI-NADOS — Tracking & Conversões',
  description: 'Painel de métricas, conversões e pixels em tempo real',
}

export const viewport: Viewport = {
  themeColor: '#08080a',
  colorScheme: 'dark',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="pt-BR"
      className={`bg-background ${inter.variable} ${geistMono.variable}`}
    >
      <body className="font-sans antialiased">
        <SectionAttr />
        <div className="app-bg" aria-hidden="true">
          <div className="app-bg__dots" />
          <div className="app-bg__aurora" />
          <div className="app-bg__amber" />
          <div className="app-bg__vignette" />
          <div className="app-bg__grain" />
        </div>
        {children}
      </body>
    </html>
  )
}
