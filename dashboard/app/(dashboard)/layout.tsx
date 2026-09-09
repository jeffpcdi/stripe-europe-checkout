import { ViewTransition } from 'react'
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
    <div className="dashboard-ui flex min-h-dvh flex-col">
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
      <TopNav><Header /></TopNav>

      <div className="min-w-0 flex-1 flex flex-col transition-colors duration-200">
        {/* Redesign: largura total fluida sem bordas/faixas pretas nas laterais em qualquer monitor (1080p, 1440p, 4K, ultrawide). */}
        <main
          id="conteudo"
          className="dashboard-main"
        >
          <ViewTransition default="none" enter="vt-fade-in" exit="vt-fade-out">
            {children}
          </ViewTransition>
        </main>
      </div>
    </div>
  )
}
