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
