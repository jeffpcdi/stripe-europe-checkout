'use client'

import { useEffect } from 'react'
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function affectedMessage(item: Record<string, unknown>, kind: 'erro' | 'aviso') {
  const field = String(item.field || '').trim()
  const issue = String(item.issue || '').trim()
  const suggestion = String(item.suggestion || '').trim()
  const count = Math.max(0, Number(item.affectedProductCount) || 0)
  const detail = [issue, suggestion].filter(Boolean).join(' — ')
  if (field && detail) return `${field} — ${detail}`
  if (field) return `Campo ${field}: ${kind} em ${count || 'um ou mais'} produto(s), sem detalhe do TikTok.`
  if (detail) return detail
  return `${count || 'Um ou mais'} produto(s) afetado(s); o TikTok não informou o campo nem o motivo.`
}

export function CatalogSyncStatus({
  catalogId,
  advertiserId,
  refreshToken = 0,
}: {
  catalogId: string
  advertiserId: string
  refreshToken?: number
}) {
  const { data, mutate } = useAdsCatalogSyncRuns(catalogId, advertiserId)
  useEffect(() => {
    if (refreshToken > 0) void mutate()
  }, [mutate, refreshToken])
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
  const auditProgress = objectValue(run.progress?.audit)
  const uploadStatus = objectValue(run.progress?.uploadStatus)
  const auditAttempts = Math.max(0, Number(run.progress?.auditAttempts) || 0)
  const expectedProducts = Math.max(0, Number(run.progress?.published) || 0)
  const remoteProducts = Math.max(0, Number(auditProgress?.total) || 0)
  const remoteMismatch = awaitingTikTok && auditAttempts >= 3 && remoteProducts !== expectedProducts
  const uploadErrors = Math.max(0, Number(uploadStatus?.errorCount) || 0)
  const uploadWarnings = Math.max(0, Number(uploadStatus?.warningCount) || 0)
  const affectedErrors = Array.isArray(uploadStatus?.errors)
    ? uploadStatus.errors.map(objectValue).filter((item): item is Record<string, unknown> => Boolean(item)).slice(0, 3)
    : []
  const affectedWarnings = Array.isArray(uploadStatus?.warnings)
    ? uploadStatus.warnings.map(objectValue).filter((item): item is Record<string, unknown> => Boolean(item)).slice(0, 3)
    : []
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
                ? 'A dashboard acompanha o arquivo pelo recibo do TikTok e só conclui depois de confirmar que ele terminou sem erros e que a quantidade esperada apareceu no catálogo.'
                : active
                  ? run.status === 'waiting_connector_confirmation'
                  ? 'O lote está salvo e será retomado automaticamente quando o conector confirmar a criação do catálogo.'
                  : 'Esta tarefa continua mesmo se você sair da página.'
                  : `Atualizado em ${new Date(run.updatedAt).toLocaleString('pt-BR')}`}
            </p>
          )}
          {uploadStatus && (
            <p className="mt-2 rounded-md bg-background/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
              Arquivo: <strong className="text-foreground">{String(uploadStatus.processStatus || 'processando')}</strong>
              {' · '}adicionados {Number(uploadStatus.addCount) || 0}
              {' · '}atualizados {Number(uploadStatus.updateCount) || 0}
              {uploadWarnings > 0 ? ` · ${uploadWarnings} aviso(s)` : ''}
              {uploadErrors > 0 ? ` · ${uploadErrors} erro(s)` : ''}
            </p>
          )}
          {affectedErrors.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 rounded-md bg-error/5 px-5 py-2 text-[10px] leading-relaxed text-error">
              {affectedErrors.map((error, index) => (
                <li key={index}>{affectedMessage(error, 'erro')}</li>
              ))}
            </ul>
          )}
          {affectedWarnings.length > 0 && (
            <ul className="mt-2 list-disc space-y-1 rounded-md bg-warning/5 px-5 py-2 text-[10px] leading-relaxed text-warning">
              {affectedWarnings.map((warning, index) => (
                <li key={index}>{affectedMessage(warning, 'aviso')}</li>
              ))}
            </ul>
          )}
          {remoteMismatch && (
            <p className="mt-2 rounded-md bg-warning/10 px-2 py-1.5 text-[10px] leading-relaxed text-warning">
              O TikTok mostrou {remoteProducts} produto(s), mas esta revisão contém {expectedProducts}. O lote continua preservado e nenhuma campanha com “todos os produtos” será criada enquanto as quantidades divergirem.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
