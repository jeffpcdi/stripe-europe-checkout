import { ViewTransition } from 'react'
import { Sidebar } from '@/components/shell/sidebar'
import { TopNav } from '@/components/shell/topnav'
import { Header } from '@/components/shell/header'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh">
      {/* Sidebar lateral esquerda — desktop */}
      <Sidebar />

      <div className="min-w-0 flex-1">
        {/* Barra superior — apenas mobile (logo + menu) */}
        <TopNav />
        <Header />
        <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-2 lg:px-6">
          <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
            {children}
          </ViewTransition>
        </main>
      </div>
    </div>
  )
}
