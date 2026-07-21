'use client'

// Página TEMPORÁRIA de verificação visual do CatalogBatchDialog (removida após o teste).
import { CatalogBatchDialog } from '@/components/ads/catalog-batch-dialog'

export default function V0TestPage() {
  return (
    <main className="min-h-screen bg-background p-8">
      <h1 className="mb-4 text-sm font-semibold text-foreground">Teste visual — Lote rápido de catálogos</h1>
      <CatalogBatchDialog advertiserId="1234567890" onCreated={() => {}} />
    </main>
  )
}
