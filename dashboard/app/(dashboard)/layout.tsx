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
import { PushSound } from '@/components/shell/push-sound'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="dashboard-ui flex min-h-dvh">
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
      {/* Som de dinheiro (cha-ching) quando push de venda chega com o painel aberto */}
      <PushSound />
      {/* Sidebar lateral esquerda — desktop.
          Item 294: wrappers display:contents (não afetam o flex) permitem ao
          modo TV esconder o chrome via html[data-tv] [data-tv-hide]. */}
      <div data-tv-hide className="contents">
        <Sidebar />
      </div>

      <div className="min-w-0 flex-1 flex flex-col transition-colors duration-200">
        {/* Barra superior — apenas mobile (logo + menu) */}
        <div data-tv-hide className="contents">
          <TopNav />
          <Header />
        </div>
        {/* Redesign: largura total fluida sem bordas/faixas pretas nas laterais em qualquer monitor (1080p, 1440p, 4K, ultrawide). */}
        <main
          id="conteudo"
          className="w-full max-w-none px-3.5 sm:px-6 lg:px-8 xl:px-10 pb-[max(4rem,calc(3rem+env(safe-area-inset-bottom)))] pl-[max(1rem,env(safe-area-inset-left))] pr-[max(1rem,env(safe-area-inset-right))] pt-3.5 sm:pt-5"
        >
          <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
            {children}
          </ViewTransition>
        </main>
      </div>
    </div>
  )
}
