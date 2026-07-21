'use client'

// Página temporária de verificação visual (removida antes do commit).

import { useState } from 'react'
import { CatalogQuickCampaignsDialog } from '@/components/ads/catalog-quick-campaigns-dialog'
import type { AdsCatalog } from '@/lib/types'

const catalog = {
  id: 'cat_test',
  name: 'Loja Verão',
  currency: 'BRL',
  country: 'BR',
  productCount: 42,
  linkStatus: 'verified',
  tiktokCatalogId: '7662123486130784016',
  bcId: '7550683248272228369',
} as unknown as AdsCatalog

export default function Page() {
  const [open, setOpen] = useState(true)
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-8">
      <button type="button" className="btn-primary text-xs" onClick={() => setOpen(true)}>
        Abrir Modo Turbo
      </button>
      <CatalogQuickCampaignsDialog
        catalog={catalog}
        advertiserId="123456"
        open={open}
        onClose={() => setOpen(false)}
        onCreated={() => {}}
      />
    </main>
  )
}
