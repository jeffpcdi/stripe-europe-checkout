import { ViewTransition } from 'react'
import { TopNav } from '@/components/shell/topnav'
import { Header } from '@/components/shell/header'
import { SubNav } from '@/components/shell/subnav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <TopNav />
      <Header />
      {/* Coluna central estreita — identidade do legado: conteúdo respirando no preto */}
      <main className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-2 lg:px-6">
        <SubNav />
        <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
          {children}
        </ViewTransition>
      </main>
    </div>
  )
}
