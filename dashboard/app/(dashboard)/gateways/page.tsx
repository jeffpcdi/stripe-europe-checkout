import { redirect } from 'next/navigation'

// Gateways e Pixels foram fundidos na aba "Conversões" (trabalham juntos).
// Esta rota fica só como redirect para não quebrar links/favoritos antigos.
export default function GatewaysPage() {
  redirect('/conversions?tab=gateways')
}
