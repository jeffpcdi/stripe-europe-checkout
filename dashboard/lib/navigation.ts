import {
  LayoutDashboard,
  Link2,
  Target,
  CreditCard,
  Globe,
  ShieldAlert,
  Settings,
  Megaphone,
  Bell,
  ShieldCheck,
  BrainCircuit,
  type LucideIcon,
} from 'lucide-react'

export type ViewId =
  | 'overview'
  | 'live'
  | 'activity'
  | 'funnel'
  | 'geo'
  | 'insights'
  | 'links'
  | 'conversions'
  | 'pixels'
  | 'gateways'
  | 'domains'
  | 'cloak'
  | 'ads'
  | 'catalog'
  | 'config'
  | 'config-alerts'
  | 'config-security'

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
    routes: ['/', '/activity', '/funnel', '/geo', '/live'],
  },
  // Fase 3: grupo "Análises" (Funil + Atividade) removido da navegação — o
  // funil compacto e o ranking de campanhas agora vivem na Visão Geral. As
  // rotas /funnel e /activity CONTINUAM acessíveis por link direto (drill-down
  // dos KPIs/feed apontam para elas); apenas saíram das pills/menu.
  {
    id: 'insights',
    label: 'Insights',
    icon: BrainCircuit,
    href: '/insights',
    routes: ['/insights'],
    tabs: [
      { label: 'Visão', href: '/insights' },
      { label: 'Campanhas', href: '/insights?tab=campaigns' },
      { label: 'Funil', href: '/insights?tab=funnel' },
      { label: 'Diagnóstico', href: '/insights?tab=diagnosis' },
    ],
  },
  {
    id: 'tracking',
    label: 'Rastreamento',
    icon: Target,
    href: '/links',
    routes: ['/links', '/cloak', '/domains', '/conversions', '/pixels', '/gateways'],
    tabs: [
      { label: 'Links', href: '/links' },
      { label: 'Cloaker', href: '/cloak' },
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
    label: 'Conta',
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
    { id: 'insights', label: 'Insights', description: 'Performance, campanhas e diagnóstico', icon: BrainCircuit, href: '/insights' },
    { id: 'ads', label: 'TikTok Ads', description: 'Campanhas e automações', icon: Megaphone, href: '/ads/tiktok' },
  ] },
  { title: 'Rastreamento', items: [
    { id: 'conversions', label: 'Conversões', description: 'Pixels, checkouts e entregas', icon: CreditCard, href: '/conversions' },
    { id: 'links', label: 'Links', description: 'Links e destinos', icon: Link2, href: '/links' },
    { id: 'domains', label: 'Domínios', description: 'Endereços próprios dos seus links', icon: Globe, href: '/domains' },
    { id: 'cloak', label: 'Cloaker', description: 'Filtro de acessos', icon: ShieldAlert, href: '/cloak' },
  ] },
  { title: 'Conta', items: [
    { id: 'config', label: 'Conta', description: 'Preferências e segurança', icon: Settings, href: '/config' },
    { id: 'config-alerts', label: 'Alertas', description: 'Resumo diário e push', icon: Bell, href: '/config?tab=notifications' },
    { id: 'config-security', label: 'Segurança', description: 'Senha, 2FA e sessões', icon: ShieldCheck, href: '/config?tab=security' },
  ] },
]
