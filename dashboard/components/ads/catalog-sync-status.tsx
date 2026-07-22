'use client'

import { AlertCircle, Check, Clock, Loader2, RotateCcw, UploadCloud } from 'lucide-react'
import { adsCatalogApiUrl, apiSend, useAdsCatalogSyncRuns } from '@/lib/api'
import { toast } from '@/lib/toast'

const LABELS: Record<string, string> = {
  queued: 'Aguardando processamento',
  waiting_connector_confirmation: 'Aguardando confirmação do conector',
  waiting_tiktok_processing: 'Aguardando processamento do TikTok',
  publishing_feed: 'Preparando o feed',
  connecting_catalog: 'Conectando o catálogo',
  uploading_products: 'Enviando produtos',
  auditing_products: 'Consultando a análise',
  processing_tiktok: 'TikTok processando os produtos',
  reviewed_tiktok: 'Análise atualizada no TikTok',
  completed: 'Sincronização concluída',
  failed: 'Sincronização interrompida',
}

export function CatalogSyncStatus({ catalogId, advertiserId }: { catalogId: string; advertiserId: string }) {
  const { data, mutate } = useAdsCatalogSyncRuns(catalogId, advertiserId)
  const run = data?.runs?.[0]
  if (!run) return null

  const runId = run.id
  const awaitingTikTok = (
    run.status === 'waiting_tiktok_processing'
    || run.status === 'completed' // compatibilidade com runs legados
  ) && run.stage === 'processing_tiktok'
  const active = ['queued', 'waiting_connector_confirmation', 'waiting_tiktok_processing', 'running', 'retrying'].includes(run.status)
  const waitingConnector = run.status === 'waiting_connector_confirmation'
  const failed = ['failed', 'partial'].includes(run.status)
  const auditProgress = run.progress && typeof run.progress.audit === 'object' && run.progress.audit !== null
    ? run.progress.audit as Record<string, unknown> : null
  const auditAttempts = Math.max(0, Number(run.progress?.auditAttempts) || 0)
  const remoteStillEmpty = awaitingTikTok && auditAttempts >= 3 && Number(auditProgress?.total) === 0
  // Ingestão por produto (get_tiktok_catalog_upload_status): quando o TikTok
  // devolve 0, este bloco diz POR QUÊ — arquivo rejeitado + erro por SKU.
  const uploadStatus = run.progress && typeof run.progress.uploadStatus === 'object' && run.progress.uploadStatus !== null
    ? run.progress.uploadStatus as { status?: string; errorCount?: number; sampleErrors?: { sku?: string; message?: string }[] }
    : null
  const uploadErrors = uploadStatus?.sampleErrors?.filter((e) => e.sku || e.message) ?? []
  const uploadFailed = uploadStatus?.status === 'failed' || uploadErrors.length > 0
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
    <section className={`rounded-xl border p-3 ${failed ? 'border-error/30 bg-error/5' : awaitingTikTok ? 'border-warning/30 bg-warning/5' : run.status === 'completed' ? 'border-success/25 bg-success/5' : 'border-primary/25 bg-primary/5'}`} aria-live="polite">
      <div className="flex items-start gap-2">
        {awaitingTikTok ? <Clock className="mt-0.5 size-4 shrink-0 text-warning" /> : active ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : failed ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-error" /> : run.status === 'completed' ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : <UploadCloud className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-[11px] font-semibold text-foreground">{LABELS[run.stage] || run.stage}</p>
          {run.error ? (
            <>
              <p className="mt-1 text-pretty text-[10px] leading-relaxed text-muted-foreground">
                <span className={`font-semibold ${waitingConnector ? 'text-primary' : 'text-error'}`}>{run.error.userMessage}</span>
                {run.error.suggestedAction ? ` ${run.error.suggestedAction}` : ''}
              </p>
              {failed && run.error.retryable && <button type="button" className="btn-primary mt-2 !py-1.5 text-xs" onClick={resume}><RotateCcw className="size-3.5" /> Retomar</button>}
            </>
          ) : (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {awaitingTikTok
                ? 'O envio terminou; falta o TikTok confirmar os produtos na auditoria.'
                : active
                  ? run.status === 'waiting_connector_confirmation'
                  ? 'O lote está salvo e será retomado automaticamente quando o conector confirmar a criação do catálogo.'
                  : 'Esta tarefa continua mesmo se você sair da página.'
                  : `Atualizado em ${new Date(run.updatedAt).toLocaleString('pt-BR')}`}
            </p>
          )}
          {remoteStillEmpty && (
            <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
              O TikTok ainda retornou 0 produtos após {auditAttempts} verificações automáticas. O lote continua preservado, mas nenhum anúncio será criado até a auditoria mostrar produtos.
            </p>
          )}
          {/* POR QUÊ ficou zero: erro de ingestão por produto (marca ausente,
              preço inválido…), lido do get_tiktok_catalog_upload_status. */}
          {uploadFailed && (
            <div className="mt-2 rounded-md bg-error/10 px-2 py-1.5 text-[10px] leading-relaxed text-error">
              <p className="font-semibold">
                O TikTok recusou {uploadStatus?.errorCount ? `${uploadStatus.errorCount} ` : ''}produto{uploadStatus?.errorCount === 1 ? '' : 's'} do arquivo — corrija e reenvie o lote:
              </p>
              {uploadErrors.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {uploadErrors.slice(0, 5).map((e, i) => (
                    <li key={i} className="truncate">
                      • {e.sku ? <span className="font-mono">{e.sku}</span> : null}{e.sku && e.message ? ': ' : ''}{e.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
