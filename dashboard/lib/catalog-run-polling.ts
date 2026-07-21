type CatalogSyncRunPollingState = {
  status: string
  stage: string
}

export function catalogSyncRunsRefreshInterval(runs: readonly CatalogSyncRunPollingState[] | undefined) {
  const current = runs ?? []
  if (current.some((run) => ['queued', 'waiting_connector_confirmation', 'running', 'retrying'].includes(run.status))) {
    return 4_000
  }
  // O upload pode estar concluído enquanto o TikTok ainda processa o feed.
  // Só paramos esse polling quando a auditoria muda para reviewed_tiktok ou
  // outro estado terminal acionável substitui processing_tiktok.
  if (current.some((run) => (
    run.status === 'waiting_tiktok_processing'
    || run.status === 'completed' // compatibilidade com runs legados
  ) && run.stage === 'processing_tiktok')) {
    return 15_000
  }
  return 0
}
