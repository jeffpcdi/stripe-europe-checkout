'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Check, Link2, Loader2, Unlink } from 'lucide-react'
import { adsCatalogApiUrl, apiSend, ApiError } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'

export function CatalogConnectionCard({
  catalog,
  advertiserId,
  bcId,
  onChanged,
}: {
  catalog: AdsCatalog
  advertiserId: string
  bcId: string
  onChanged: () => void | Promise<unknown>
}) {
  const [catalogId, setCatalogId] = useState(catalog.tiktokCatalogId ?? '')
  const [busy, setBusy] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const verified = catalog.linkStatus === 'verified'

  useEffect(() => {
    setCatalogId(catalog.tiktokCatalogId ?? '')
  }, [catalog.tiktokCatalogId])

  async function connect() {
    if (!/^\d{6,30}$/.test(catalogId.trim())) {
      toast.error('Catalog ID inválido')
      return
    }
    setBusy(true)
    try {
      const result = await apiSend<{ catalog: AdsCatalog; remote: { name?: string; productCount?: number } }>(
        adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalog.id)}/link`, advertiserId), 'POST',
        { tiktokCatalogId: catalogId.trim(), bcId },
      )
      toast.success('Catálogo TikTok verificado', { hint: result.remote?.name ? `${result.remote.name} · ${result.remote.productCount ?? 0} produto(s)` : undefined })
      await onChanged()
    } catch (error) {
      toast.error('Não foi possível verificar o catálogo', { hint: error instanceof ApiError ? error.display : error instanceof Error ? error.message : undefined })
      await onChanged()
    } finally {
      setBusy(false)
    }
  }

  async function disconnect() {
    setBusy(true)
    try {
      await apiSend(adsCatalogApiUrl(`/api/ads/catalogs/${encodeURIComponent(catalog.id)}/link`, advertiserId), 'DELETE')
      setCatalogId('')
      toast.success('Vínculo removido')
      await onChanged()
    } catch (error) {
      toast.error('Falha ao remover vínculo', { hint: error instanceof Error ? error.message : undefined })
    } finally {
      setBusy(false)
      setConfirmDisconnect(false)
    }
  }

  return (
    <>
    <section className={`rounded-xl border p-4 ${verified ? 'border-success/30 bg-success/5' : catalog.linkStatus === 'error' ? 'border-error/30 bg-error/5' : 'border-primary/25 bg-primary/5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {verified ? <Check className="size-4 text-success" /> : catalog.linkStatus === 'error' ? <AlertCircle className="size-4 text-error" /> : <Link2 className="size-4 text-primary" />}
            Conexão com o TikTok
          </p>
          <p className="mt-1 text-pretty text-[11px] text-muted-foreground">
            {verified ? `Vínculo verificado no Business Center ${catalog.bcId}.` : catalog.linkError || 'Informe o catálogo existente; a dashboard consultará o TikTok antes de salvar.'}
          </p>
        </div>
        {verified && <span className="rounded-full bg-success/15 px-2.5 py-1 text-[10px] font-semibold text-success">Verificado</span>}
      </div>

      {catalog.remoteSnapshot && verified && (
        <dl className="mt-3 grid gap-2 rounded-lg border border-success/20 bg-background/60 p-3 text-[11px] sm:grid-cols-3">
          <div><dt className="text-muted-foreground">Catálogo</dt><dd className="font-medium text-foreground">{catalog.remoteSnapshot.name || catalog.tiktokCatalogId}</dd></div>
          <div><dt className="text-muted-foreground">Moeda / país</dt><dd className="font-medium text-foreground">{catalog.remoteSnapshot.currency || '—'} · {catalog.remoteSnapshot.country || '—'}</dd></div>
          <div><dt className="text-muted-foreground">Produtos remotos</dt><dd className="font-medium text-foreground">{catalog.remoteSnapshot.productCount}</dd></div>
        </dl>
      )}

      {catalog.linkStatus === 'error' && (
        <p className="mt-3 rounded-lg border border-error/20 bg-background/60 p-2.5 text-pretty text-[10px] leading-relaxed text-muted-foreground">
          Seus produtos locais continuam salvos. Se o catálogo remoto foi excluído, crie ou abra outro no TikTok Catalog Manager e substitua o Catalog ID abaixo.
        </p>
      )}

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          className="input-neon min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
          value={catalogId}
          onChange={(event) => setCatalogId(event.target.value.replace(/\D/g, '').slice(0, 30))}
          inputMode="numeric"
          placeholder="Catalog ID do TikTok"
          aria-label="Catalog ID do TikTok"
          disabled={busy || verified}
        />
        {verified ? (
          <button type="button" className="btn-ghost text-xs text-error" onClick={() => setConfirmDisconnect(true)} disabled={busy}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Unlink className="size-3.5" />} Desconectar
          </button>
        ) : (
          <button type="button" className="btn-primary text-xs" onClick={connect} disabled={busy || !bcId || !catalogId}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />} Verificar e conectar
          </button>
        )}
      </div>
      {!bcId && <p className="mt-2 text-[10px] text-warning">Configure o Business Center antes de verificar o catálogo.</p>}
    </section>
    <ConfirmDialog
      open={confirmDisconnect}
      title="Remover vínculo com o TikTok?"
      description="O Catalog ID será removido desta dashboard. Seus produtos locais, feed e o catálogo remoto no TikTok serão preservados."
      confirmLabel="Remover vínculo"
      busy={busy}
      onConfirm={disconnect}
      onClose={() => setConfirmDisconnect(false)}
    />
    </>
  )
}
