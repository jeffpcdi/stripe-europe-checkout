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
  /** preparação opcional do contexto antes de medir o alvo (ex.: trocar tab) */
  activate?: {
    event: string
    value: string
  }
}

export interface Tour {
  /** chave de persistência (tour:<key>:done) */
  key: string
  label: string
  steps: TourStep[]
  appearance?: 'default' | 'quiet'
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
      body: 'Receita, gasto, ROAS e funil usam a mesma janela no fuso de Brasília: hoje, 7 dias, 30 dias ou tudo.',
    },
    {
      target: 'confidence',
      title: 'Confiança dos dados',
      body: 'Abra este diagnóstico para conferir vendas ligadas à jornada, origem, hospedagens, pixels e gateways. Cada alerta leva direto à correção.',
    },
    {
      target: 'kpis',
      title: 'Indicadores',
      body: 'Receita confirmada pelo gateway, gasto do TikTok Ads e ROAS do período. Moedas diferentes nunca são somadas nem divididas.',
    },
    {
      target: 'chart',
      title: 'Operação agora',
      body: 'O globo mostra presença em tempo real; os indicadores ao redor mostram o período selecionado. São ritmos diferentes e ficam identificados.',
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
      body: 'Comece por aqui: dê um nome e um slug (o endereço final do seu link). É o link que você divulga.',
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
      body: 'Digite um subdomínio seu. Depois do cadastro, os registros DNS aparecem e a verificação acompanha o progresso automaticamente.',
    },
    {
      target: 'domains-list',
      title: 'Acompanhar configuração',
      body: 'Cada domínio mostra o progresso entre DNS, HTTPS e Ativo. Abra “DNS e detalhes” para copiar os registros necessários.',
    },
  ],
}

/** Item 27: tour do Cloaker */
const CLOAK_TOUR: Tour = {
  key: 'cloak',
  label: 'Cloaker',
  appearance: 'quiet',
  steps: [
    {
      target: 'cloak-stats',
      title: 'Resultados',
      body: 'Veja quantos acessos seguiram para o destino principal ou seguro, os principais motivos de desvio e quais links concentram essas decisões.',
      activate: { event: 'roinados:cloak-tab', value: 'overview' },
    },
    {
      target: 'cloak-config',
      title: 'Configurar proteção',
      body: 'Ative a proteção, escolha o comportamento para acessos suspeitos, ajuste a sensibilidade e defina o destino seguro padrão. As opções técnicas ficam em Configurações avançadas.',
      activate: { event: 'roinados:cloak-tab', value: 'rules' },
    },
    {
      target: 'cloak-test',
      title: 'Validar configuração',
      body: 'O teste usa a última configuração salva. Use seu acesso atual ou um cenário sintético para confirmar o comportamento antes de publicar.',
      activate: { event: 'roinados:cloak-tab', value: 'rules' },
    },
    {
      target: 'cloak-links',
      title: 'Links protegidos',
      body: 'Crie URLs com destinos e regras próprias. Cada link mostra a proteção efetiva, sensibilidade, segmentação, testes e histórico.',
      activate: { event: 'roinados:cloak-tab', value: 'traffic' },
    },
  ],
}

/** Tour final do TikTok Ads — acompanha as três áreas reais da workspace. */
const ADS_TOUR: Tour = {
  key: 'ads',
  label: 'TikTok Ads',
  appearance: 'quiet',
  steps: [
    {
      target: 'ads-context',
      title: 'Conta e sincronização',
      body: 'Escolha a conta que está operando e confirme se os dados do TikTok estão atualizados antes de tomar decisões.',
    },
    {
      target: 'ads-tabs',
      title: 'Três áreas de trabalho',
      body: 'Campanhas concentra operação e criação. Catálogo cuida de produtos e campanhas de catálogo. Automações reúne regras, aprovações e segurança.',
    },
    {
      target: 'ads-campaign-actions',
      title: 'Operar e criar',
      body: 'Gerencie públicos ou crie uma campanha. Conversão, Smart+ e Spark mantêm regras próprias e nascem pausadas para revisão.',
      activate: { event: 'roinados:ads-tab', value: 'campaigns' },
    },
    {
      target: 'ads-campaigns',
      title: 'Campanhas',
      body: 'A lista prioriza orçamento, gasto, vendas reais, CPA e ROAS. Abra uma campanha para aprofundar estrutura, resultado e histórico.',
      activate: { event: 'roinados:ads-tab', value: 'campaigns' },
    },
    {
      target: 'ads-catalog',
      title: 'Catálogo',
      body: 'Produtos, feed e publicação no TikTok ficam concentrados aqui.',
      activate: { event: 'roinados:ads-tab', value: 'catalog' },
    },
    {
      target: 'ads-automation',
      title: 'Automações',
      body: 'Regras, aprovações e limites ficam aqui. A interface mostra quando uma decisão depende da sua aprovação.',
      activate: { event: 'roinados:ads-tab', value: 'automation' },
    },
    {
      target: 'ads-tabs',
      title: 'Pronto para operar',
      body: 'Use Campanhas como ponto principal do dia a dia e abra as outras áreas quando a tarefa exigir.',
      activate: { event: 'roinados:ads-tab', value: 'campaigns' },
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

/** Resolve o tour da rota atual (pathname sem basePath). A busca vem do
 * componente para que SSR e a primeira hidratação usem a mesma entrada. */
export function tourForPath(pathname: string, search = ''): Tour | null {
  if (pathname === '/' || pathname === '') return OVERVIEW_TOUR
  if (pathname.startsWith('/geo')) return GEO_TOUR
  if (pathname.startsWith('/live')) return LIVE_TOUR
  if (pathname.startsWith('/links')) return LINKS_TOUR
  // Conversões funde Gateways+Pixels; o tour segue o segmento aberto (?tab=).
  if (pathname.startsWith('/conversions')) {
    const seg = new URLSearchParams(search).get('tab')
    return seg === 'pixels' ? PIXELS_TOUR : GATEWAYS_TOUR
  }
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
