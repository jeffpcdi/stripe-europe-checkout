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
    label: 'Visão geral',
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
      { label: 'Links', href: '/links' },
      { label: 'Proteção', href: '/cloak' },
      { label: 'Domínios', href: '/domains' },
      { label: 'Conversões', href: '/conversions' },
    ],
  },
  {
    id: 'ads',
    label: 'TikTok Ads',
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
  { title: 'Operação', items: [
    { id: 'overview', label: 'Visão geral', description: 'Resultados e visitantes online', icon: LayoutDashboard, href: '/' },
    { id: 'ads', label: 'TikTok Ads', description: 'Campanhas, catálogos e automações', icon: Megaphone, href: '/ads/tiktok' },
  ] },
  { title: 'Rastreamento', items: [
    { id: 'conversions', label: 'Conversões', description: 'Vendas, pagamentos e pixels', icon: CreditCard, href: '/conversions' },
    { id: 'links', label: 'Links', description: 'Links de venda e seus resultados', icon: Link2, href: '/links' },
    { id: 'domains', label: 'Domínios', description: 'Endereços próprios dos seus links', icon: Globe, href: '/domains' },
    { id: 'cloak', label: 'Proteção', description: 'Filtro de acessos automatizados', icon: ShieldAlert, href: '/cloak' },
  ] },
  { title: 'Conta', items: [
    { id: 'config', label: 'Configurações', description: 'Preferências, notificações e segurança', icon: Settings, href: '/config' },
  ] },
]
