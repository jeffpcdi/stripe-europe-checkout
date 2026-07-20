import { redirect } from 'next/navigation'

// Pixels e Gateways foram fundidos na aba "Conversões" (trabalham juntos).
// Esta rota fica só como redirect para não quebrar links/favoritos antigos.
export default function PixelsPage() {
  redirect('/conversions?tab=pixels')
}
