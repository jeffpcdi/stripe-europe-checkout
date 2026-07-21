'use client'

import { AlertCircle, Check, Loader2, RotateCcw, UploadCloud } from 'lucide-react'
import { adsCatalogApiUrl, apiSend, useAdsCatalogSyncRuns } from '@/lib/api'
import { toast } from '@/lib/toast'

const LABELS: Record<string, string> = {
  queued: 'Aguardando processamento',
  publishing_feed: 'Preparando o feed',
  connecting_catalog: 'Conectando o catálogo',
  uploading_products: 'Enviando produtos',
  auditing_products: 'Consultando a análise',
  processing_tiktok: 'TikTok processando os produtos',
  completed: 'Sincronização concluída',
  failed: 'Sincronização interrompida',
}

export function CatalogSyncStatus({ catalogId, advertiserId }: { catalogId: string; advertiserId: string }) {
  const { data, mutate } = useAdsCatalogSyncRuns(catalogId, advertiserId)
  const run = data?.runs?.[0]
  if (!run) return null

  const runId = run.id
  const active = ['queued', 'running', 'retrying'].includes(run.status)
  const failed = ['failed', 'partial'].includes(run.status)
  async function resume() {
    try {
      await apiSend(adsCatalogApiUrl(`/api/ads/catalog-sync-runs/${encodeURIComponent(runId)}/resume`, advertiserId), 'POST', {})
      toast.success('Sincronização colocada novamente na fila')
      await mutate()
    } catch (error) {
      toast.error('Não foi possível retomar', { hint: error instanceof Error ? error.message : undefined })
    }
  }
  return (
    <section className={`rounded-xl border p-3 ${failed ? 'border-error/30 bg-error/5' : run.status === 'completed' ? 'border-success/25 bg-success/5' : 'border-primary/25 bg-primary/5'}`} aria-live="polite">
      <div className="flex items-start gap-2">
        {active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : failed ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-error" /> : run.status === 'completed' ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <UploadCloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-foreground">{LABELS[run.stage] || run.stage}</p>
          {run.error ? (
            <>
              <p className="mt-1 text-pretty text-[10px] leading-relaxed text-muted-foreground">
                <span className="font-semibold text-error">{run.error.userMessage}</span>
                {run.error.suggestedAction ? ` ${run.error.suggestedAction}` : ''}
              </p>
              {failed && run.error.retryable && <button type="button" className="btn-primary mt-2 !py-1.5 text-xs" onClick={resume}><RotateCcw className="size-3.5" /> Retomar</button>}
            </>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {active ? 'Esta tarefa continua mesmo se você sair da página.' : `Atualizado em ${new Date(run.updatedAt).toLocaleString('pt-BR')}`}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
