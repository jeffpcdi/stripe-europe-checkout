/**
 * Bloco H (itens 45–48): motor de tours interativos por página.
 * Cada passo aponta para um elemento com data-tour="id"; a conclusão
 * é persistida em localStorage para não repetir a cada visita.
 */

export interface TourStep {
  /** valor do atributo data-tour do elemento-alvo */
  target: string
  title: string
  body: string
}

export interface Tour {
  /** chave de persistência (tour:<key>:done) */
  key: string
  label: string
  steps: TourStep[]
}

/** Item 46: tour da Visão Geral */
const OVERVIEW_TOUR: Tour = {
  key: 'overview',
  label: 'Visão Geral',
  steps: [
    {
      target: 'nav',
      title: 'Navegação',
      body: 'Alterne entre métricas, gestão e sistema por aqui. Cmd+K abre a busca rápida de páginas.',
    },
    {
      target: 'period',
      title: 'Período',
      body: 'Todos os números da página respeitam o período escolhido: hoje, 7 dias, 30 dias ou tudo.',
    },
    {
      target: 'kpis',
      title: 'Indicadores',
      body: 'Receita, vendas, aprovação e visitas do período. Em telas pequenas, deslize para o lado.',
    },
    {
      target: 'chart',
      title: 'Desempenho',
      body: 'Curva de receita, vendas ou leads dia a dia. Toque nas abas para trocar a métrica.',
    },
    {
      target: 'live-badge',
      title: 'Ao vivo',
      body: 'Este ponto verde pulsa quando o rastreamento está saudável. Toque para ver visitantes em tempo real.',
    },
  ],
}

/** Item 47: tour da Geografia */
const GEO_TOUR: Tour = {
  key: 'geo',
  label: 'Geografia',
  steps: [
    {
      target: 'globe',
      title: 'Globo de tráfego',
      body: 'Cada ponto é um país com visitas. Rosa indica vendas; arraste para girar.',
    },
    {
      target: 'globe-controls',
      title: 'Controles',
      body: 'Aproxime, afaste ou recentre o globo. O botão de expandir abre em tela cheia.',
    },
    {
      target: 'geo-metric',
      title: 'Visitas × Vendas',
      body: 'Alterne a métrica: em Vendas, só países com compra aparecem, em verde.',
    },
    {
      target: 'geo-table',
      title: 'Ranking de países',
      body: 'Passe o mouse numa linha para girar o globo até o país correspondente.',
    },
  ],
}

/** Item 48: tour do Ao Vivo */
const LIVE_TOUR: Tour = {
  key: 'live',
  label: 'Ao Vivo',
  steps: [
    {
      target: 'live-counter',
      title: 'Visitantes agora',
      body: 'Total de sessões ativas nos últimos 5 minutos, atualizado a cada poucos segundos.',
    },
    {
      target: 'live-sessions',
      title: 'Sessões',
      body: 'Cada card é um visitante: país, página e há quanto tempo entrou. A barra mostra o tempo restante da sessão.',
    },
    {
      target: 'live-countries',
      title: 'Países ativos',
      body: 'Resumo por país das sessões ativas neste exato momento.',
    },
  ],
}

/** Item 27: tour dos Links */
const LINKS_TOUR: Tour = {
  key: 'links',
  label: 'Links',
  steps: [
    {
      target: 'links-new',
      title: 'Criar link',
      body: 'Comece por aqui: dê um nome e um slug (o final de /go/slug). É o link que você divulga.',
    },
    {
      target: 'links-list',
      title: 'Seus links',
      body: 'Cada card mostra cliques, o destino e o domínio usado. Toque para editar destino, split A/B e cloak.',
    },
    {
      target: 'links-qr',
      title: 'QR e cópia',
      body: 'Gere o QR code na hora ou copie a URL curta para colar no anúncio, bio ou stories.',
    },
  ],
}

/** Item 27: tour dos Pixels */
const PIXELS_TOUR: Tour = {
  key: 'pixels',
  label: 'Pixels',
  steps: [
    {
      target: 'pixels-new',
      title: 'Novo pixel',
      body: 'Cole o Pixel Code (ex.: C0ABC123) e o Access Token da Events API. É o que conecta seu tráfego ao TikTok.',
    },
    {
      target: 'pixels-list',
      title: 'Seus pixels',
      body: 'Ligue/desligue eventos (Visita, Carrinho, Checkout) e veja o status de cada pixel.',
    },
    {
      target: 'pixels-verify',
      title: 'Verificar instalação',
      body: 'Cole a URL da sua página e confirme se o script está instalado — sem precisar abrir o console.',
    },
    {
      target: 'pixels-health',
      title: 'Saúde e log',
      body: 'Acompanhe a qualidade dos eventos (EMQ), a fila de retry e cada disparo enviado ao TikTok.',
    },
  ],
}

/** Item 27: tour dos Gateways */
const GATEWAYS_TOUR: Tour = {
  key: 'gateways',
  label: 'Gateways',
  steps: [
    {
      target: 'gateways-new',
      title: 'Conectar gateway',
      body: 'Escolha o provedor (Kiwify, Hotmart, etc.) e geramos uma URL de webhook exclusiva para você colar lá.',
    },
    {
      target: 'gateways-list',
      title: 'Seus gateways',
      body: 'É por aqui que as vendas confirmadas viram o evento de Compra. Teste, edite ou rotacione o segredo em cada card.',
    },
    {
      target: 'gateways-webhooks',
      title: 'Webhooks recebidos',
      body: 'Veja em tempo real cada notificação que o gateway enviou e o resultado do processamento.',
    },
  ],
}

/** Item 27: tour dos Domínios */
const DOMAINS_TOUR: Tour = {
  key: 'domains',
  label: 'Domínios',
  steps: [
    {
      target: 'domains-add',
      title: 'Adicionar domínio',
      body: 'Digite um subdomínio seu (ex.: link.seudominio.com). O roteamento e o SSL são automáticos.',
    },
    {
      target: 'domains-use',
      title: 'Uso do domínio',
      body: 'Escolha se ele serve para checkout, cloaker ou ambos — o badge no card mostra o uso atual.',
    },
    {
      target: 'domains-list',
      title: 'Verificação',
      body: 'Depois de apontar o DNS, a verificação roda sozinha. O card mostra o estado e o passo a passo em caso de pendência.',
    },
  ],
}

/** Item 27: tour do Cloaker */
const CLOAK_TOUR: Tour = {
  key: 'cloak',
  label: 'Cloaker',
  steps: [
    {
      target: 'cloak-test',
      title: 'Teste ao vivo',
      body: 'Simule um acesso e veja o veredito: quem vê a página branca (segura) e quem vê a oferta.',
    },
    {
      target: 'cloak-config',
      title: 'Regras e threshold',
      body: 'Ajuste o score mínimo e os sinais analisados. Quanto maior o threshold, mais rígido o filtro.',
    },
    {
      target: 'cloak-stats',
      title: 'Estatísticas',
      body: 'Acompanhe quantos acessos foram para a oferta vs. página branca e os últimos bloqueios.',
    },
  ],
}

/** Tour da aba TikTok Ads (âncoras na aba inicial "Hoje") */
const ADS_TOUR: Tour = {
  key: 'ads',
  label: 'TikTok Ads',
  steps: [
    {
      target: 'ads-context',
      title: 'Sua conta e a conexão',
      body: 'Escolha a conta de anúncio e veja num relance se a conexão com o TikTok está saudável.',
    },
    {
      target: 'ads-tabs',
      title: 'Quatro abas, um fluxo',
      body: 'Hoje (seu dia), Campanhas (criar e operar, inclui Smart+), Automações (o robô) e Catálogo.',
    },
    {
      target: 'ads-inbox',
      title: 'Precisa de você',
      body: 'Aqui você decide num toque o que o robô propôs — pausar ou ajustar orçamento. Nada acontece sem o seu OK.',
    },
    {
      target: 'ads-feed',
      title: 'O que o robô fez',
      body: 'Transparência total: cada ação e proposta do robô fica registrada, com o resultado.',
    },
  ],
}

/** Mapa rota → tour disponível */
export const TOURS: Record<string, Tour> = {
  '/': OVERVIEW_TOUR,
  '/geo': GEO_TOUR,
  '/live': LIVE_TOUR,
  '/links': LINKS_TOUR,
  '/pixels': PIXELS_TOUR,
  '/gateways': GATEWAYS_TOUR,
  '/domains': DOMAINS_TOUR,
  '/cloak': CLOAK_TOUR,
  '/ads/tiktok': ADS_TOUR,
}

/** Resolve o tour da rota atual (pathname sem basePath) */
export function tourForPath(pathname: string): Tour | null {
  if (pathname === '/' || pathname === '') return OVERVIEW_TOUR
  if (pathname.startsWith('/geo')) return GEO_TOUR
  if (pathname.startsWith('/live')) return LIVE_TOUR
  if (pathname.startsWith('/links')) return LINKS_TOUR
  if (pathname.startsWith('/pixels')) return PIXELS_TOUR
  if (pathname.startsWith('/gateways')) return GATEWAYS_TOUR
  if (pathname.startsWith('/domains')) return DOMAINS_TOUR
  if (pathname.startsWith('/cloak')) return CLOAK_TOUR
  if (pathname.startsWith('/ads')) return ADS_TOUR
  return null
}

const doneKey = (key: string) => `tour:${key}:done`

export function isTourDone(key: string): boolean {
  try {
    return window.localStorage.getItem(doneKey(key)) === '1'
  } catch {
    return true
  }
}

export function markTourDone(key: string) {
  try {
    window.localStorage.setItem(doneKey(key), '1')
  } catch {
    /* sem storage — ignora */
  }
}
