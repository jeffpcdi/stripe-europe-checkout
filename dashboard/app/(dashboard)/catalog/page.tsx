import { redirect } from 'next/navigation'

// O Catálogo virou sub-aba da página TikTok Ads (Anúncios → Catálogo).
// Esta rota fica só como redirect para não quebrar links/favoritos antigos.
export default function CatalogPage() {
  redirect('/ads/tiktok?tab=catalog')
}
