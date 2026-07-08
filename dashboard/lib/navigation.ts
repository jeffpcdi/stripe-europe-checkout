import {
  LayoutDashboard,
  Radio,
  ListChecks,
  Filter,
  Globe2,
  Link2,
  Target,
  CreditCard,
  Globe,
  ShieldAlert,
  Settings,
  type LucideIcon,
} from 'lucide-react'

export type ViewId =
  | 'overview'
  | 'live'
  | 'activity'
  | 'funnel'
  | 'geo'
  | 'links'
  | 'pixels'
  | 'gateways'
  | 'domains'
  | 'cloak'
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
  {
    id: 'live',
    label: 'Ao Vivo',
    icon: Radio,
    href: '/live',
    routes: ['/live', '/geo', '/activity', '/funnel'],
    tabs: [
      { label: 'Ao Vivo', href: '/live' },
      { label: 'Geografia', href: '/geo' },
      { label: 'Funil', href: '/funnel' },
      { label: 'Atividade', href: '/activity' },
    ],
  },
  {
    id: 'tracking',
    label: 'Rastreamento',
    icon: Target,
    href: '/links',
    routes: ['/links', '/cloak', '/domains', '/pixels', '/gateways'],
    tabs: [
      { label: 'Links de Checkout', href: '/links' },
      { label: 'Filtro de Bots', href: '/cloak' },
      { label: 'Domínios', href: '/domains' },
      { label: 'Pixel TikTok', href: '/pixels' },
      { label: 'Gateways', href: '/gateways' },
    ],
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
      { id: 'overview', label: 'Visão Geral', description: 'KPIs e gráficos', icon: LayoutDashboard, href: '/' },
      { id: 'live', label: 'Ao Vivo', description: 'Eventos em tempo real', icon: Radio, href: '/live' },
      { id: 'activity', label: 'Atividade', description: 'Log de conversões e pixels', icon: ListChecks, href: '/activity' },
      { id: 'funnel', label: 'Funil', description: 'Visita, checkout, compra', icon: Filter, href: '/funnel' },
      { id: 'geo', label: 'Geografia', description: 'Globo de eventos', icon: Globe2, href: '/geo' },
    ],
  },
  {
    title: 'Gestão',
    items: [
      { id: 'links', label: 'Links', description: 'Links e shortlinks', icon: Link2, href: '/links' },
      { id: 'pixels', label: 'Pixels', description: 'Saúde e EMQ', icon: Target, href: '/pixels' },
      { id: 'gateways', label: 'Gateways', description: 'Gateways de pagamento', icon: CreditCard, href: '/gateways' },
      { id: 'domains', label: 'Domínios', description: 'Domínios verificados', icon: Globe, href: '/domains' },
      { id: 'cloak', label: 'Cloaker', description: 'Filtros e entries', icon: ShieldAlert, href: '/cloak' },
    ],
  },
  {
    title: 'Sistema',
    items: [
      { id: 'config', label: 'Configurações', description: 'Pushcut, notas, reset', icon: Settings, href: '/config' },
    ],
  },
]
