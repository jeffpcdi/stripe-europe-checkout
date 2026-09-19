import { Suspense, ViewTransition } from 'react'
import { TopNav } from '@/components/shell/topnav'
import { Header } from '@/components/shell/header'
import { SubNav } from '@/components/shell/subnav'
import { TabNotifier } from '@/components/shell/tab-notifier'
import { RouteProgress } from '@/components/shell/route-progress'
import { CommandPalette } from '@/components/shell/command-palette'
import { TourGuide } from '@/components/shell/tour'
import { Toaster } from '@/components/shell/toaster'
import { ClientErrorReporter } from '@/components/shell/client-error-reporter'
import { PushSound } from '@/components/shell/push-sound'
import { OverviewPeriodProvider } from '@/lib/overview-period'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <OverviewPeriodProvider><div className="dashboard-ui flex min-h-dvh flex-col">
      <a href="#conteudo" className="skip-link">
        Pular para conteúdo
      </a>
      <TabNotifier />
      <RouteProgress />
      <CommandPalette />
      <TourGuide />
      <Toaster />
      <ClientErrorReporter />
      <PushSound />
      <TopNav><Header /></TopNav>
      <Suspense fallback={null}><SubNav /></Suspense>

      <div className="min-w-0 flex-1 flex flex-col transition-colors duration-200">
        <main
          id="conteudo"
          className="dashboard-main"
        >
          <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
            {children}
          </ViewTransition>
        </main>
      </div>
    </div></OverviewPeriodProvider>
  )
}
