import {
  LayoutDashboard,
  Link2,
  Target,
  CreditCard,
  Globe,
  ShieldAlert,
  Settings,
  Megaphone,
  type LucideIcon,
} from 'lucide-react'

export type ViewId =
  | 'overview'
  | 'live'
  | 'activity'
  | 'funnel'
  | 'geo'
  | 'links'
  | 'conversions'
  | 'pixels'
  | 'gateways'
  | 'domains'
  | 'cloak'
  | 'ads'
  | 'catalog'
  | 'config'

export interface NavItem {
  id: ViewId
  label: string
  description: string
  icon: LucideIcon
  href: string
}

/* Grupos de topo — identidade do dashboard legado: 4 pills centralizadas */
export interface NavGroup {
  id: string
  label: string
  icon: LucideIcon
  href: string
  /** rotas cobertas por este grupo (prefixos) */
  routes: string[]
  /** sub-abas exibidas abaixo do header quando o grupo está ativo */
  tabs?: { label: string; href: string }[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'overview',
    label: 'Visão Geral',
    icon: LayoutDashboard,
    href: '/',
    routes: ['/'],
  },
  // Fase 3: grupo "Análises" (Funil + Atividade) removido da navegação — o
  // funil compacto e o ranking de campanhas agora vivem na Visão Geral. As
  // rotas /funnel e /activity CONTINUAM acessíveis por link direto (drill-down
  // dos KPIs/feed apontam para elas); apenas saíram das pills/menu.
  {
    id: 'tracking',
    label: 'Rastreamento',
    icon: Target,
    href: '/links',
    routes: ['/links', '/cloak', '/domains', '/conversions', '/pixels', '/gateways'],
    tabs: [
      { label: 'Links de Checkout', href: '/links' },
      { label: 'Filtro de Bots', href: '/cloak' },
      { label: 'Domínios', href: '/domains' },
      { label: 'Conversões', href: '/conversions' },
    ],
  },
  {
    id: 'ads',
    label: 'Anúncios',
    icon: Megaphone,
    href: '/ads/tiktok',
    // /catalog segue nas rotas só p/ o redirect legado manter o grupo ativo
    routes: ['/ads', '/catalog'],
  },
  {
    id: 'config',
    label: 'Configurações',
    icon: Settings,
    href: '/config',
    routes: ['/config'],
  },
]

export function activeGroup(pathname: string): NavGroup {
  return (
    NAV_GROUPS.find((g) =>
      g.routes.some((r) => (r === '/' ? pathname === '/' : pathname.startsWith(r))),
    ) ?? NAV_GROUPS[0]
  )
}

export const NAV_SECTIONS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Métricas',
    items: [
      { id: 'overview', label: 'Visão Geral', description: 'KPIs, funil, presença ao vivo e campanhas', icon: LayoutDashboard, href: '/' },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { id: 'links', label: 'Links', description: 'Links e shortlinks', icon: Link2, href: '/links' },
      { id: 'conversions', label: 'Conversões', description: 'Gateways + Pixels (venda → CAPI)', icon: CreditCard, href: '/conversions' },
      { id: 'domains', label: 'Domínios', description: 'Domínios verificados', icon: Globe, href: '/domains' },
      { id: 'cloak', label: 'Cloaker', description: 'Filtros e entries', icon: ShieldAlert, href: '/cloak' },
      { id: 'ads', label: 'TikTok Ads', description: 'Campanhas, Smart+, catálogo e automações', icon: Megaphone, href: '/ads/tiktok' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { id: 'config', label: 'Configurações', description: 'iPhone, conta e segurança', icon: Settings, href: '/config' },
    ],
  },
]
