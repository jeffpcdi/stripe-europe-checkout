import { ViewTransition } from 'react'
import { Sidebar } from '@/components/shell/sidebar'
import { TopNav } from '@/components/shell/topnav'
import { Header } from '@/components/shell/header'
import { TabNotifier } from '@/components/shell/tab-notifier'
import { RouteProgress } from '@/components/shell/route-progress'
import { CommandPalette } from '@/components/shell/command-palette'
import { TourGuide } from '@/components/shell/tour'
import { Toaster } from '@/components/shell/toaster'
import { ClientErrorReporter } from '@/components/shell/client-error-reporter'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-dvh">
      {/* Item 102: skip-link acessível — aparece no primeiro Tab */}
      <a href="#conteudo" className="skip-link">
        Pular para conteúdo
      </a>
      {/* Itens 201/202: título da aba + favicon reagem a vendas e saúde */}
      <TabNotifier />
      {/* Item 61: barra de progresso de rota no topo da viewport */}
      <RouteProgress />
      {/* Item 87: busca rápida de páginas com Cmd+K / Ctrl+K */}
      <CommandPalette />
      {/* Bloco H: tours interativos por página + botão "?" flutuante */}
      <TourGuide />
      {/* Item 183: toaster global de feedback (aria-live) */}
      <Toaster />
      {/* Item 561: erros de front reportados ao backend (senão são invisíveis) */}
      <ClientErrorReporter />
      {/* Sidebar lateral esquerda — desktop.
          Item 294: wrappers display:contents (não afetam o flex) permitem ao
          modo TV esconder o chrome via html[data-tv] [data-tv-hide]. */}
      <div data-tv-hide className="contents">
        <Sidebar />
      </div>

      <div className="min-w-0 flex-1">
        {/* Barra superior — apenas mobile (logo + menu) */}
        <div data-tv-hide className="contents">
          <TopNav />
          <Header />
        </div>
        <main
          id="conteudo"
          className="mx-auto w-full max-w-[1100px] px-4 pb-16 pt-2 lg:px-6"
        >
          <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
            {children}
          </ViewTransition>
        </main>
      </div>
    </div>
  )
}
