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

/** Mapa rota → tour disponível */
export const TOURS: Record<string, Tour> = {
  '/': OVERVIEW_TOUR,
  '/geo': GEO_TOUR,
  '/live': LIVE_TOUR,
}

/** Resolve o tour da rota atual (pathname sem basePath) */
export function tourForPath(pathname: string): Tour | null {
  if (pathname === '/' || pathname === '') return OVERVIEW_TOUR
  if (pathname.startsWith('/geo')) return GEO_TOUR
  if (pathname.startsWith('/live')) return LIVE_TOUR
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
