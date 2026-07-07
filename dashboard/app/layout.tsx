import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Dashboard — Tracking & Conversões',
  description: 'Painel de métricas, conversões e pixels em tempo real',
}

export const viewport: Viewport = {
  themeColor: '#08080a',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className="bg-background">
      <body className="font-sans antialiased">
        <div className="aurora-bg" aria-hidden="true" />
        {children}
      </body>
    </html>
  )
}
