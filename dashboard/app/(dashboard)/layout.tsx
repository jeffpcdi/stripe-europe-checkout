import { ViewTransition } from 'react'
import { Sidebar } from '@/components/shell/sidebar'
import { Header } from '@/components/shell/header'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh">
      <Sidebar />
      <main className="px-4 py-4 pb-10 lg:pl-[17rem] lg:pr-6">
        <Header />
        <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
          {children}
        </ViewTransition>
      </main>
    </div>
  )
}
