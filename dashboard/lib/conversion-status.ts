import type { ConversionLogRow } from './types'

export function conversionStatus(row: ConversionLogRow) {
  const status = String(row.status || '').toLowerCase()
  if (row.teste || /teste|simula/.test(status)) return { kind: 'neutral', label: 'Teste interno' }
  if (/dedup|duplic/.test(status)) return { kind: 'neutral', label: 'Duplicado ignorado' }
  if (/sem capi/.test(status)) return { kind: 'neutral', label: 'Sem envio ao TikTok' }
  if (/aguard|pendente|recebido|fila/.test(status)) return { kind: 'pending', label: 'Aguardando envio' }
  const results = Array.isArray(row.capi) ? row.capi : []
  if (results.length && results.every(r => r.ok === true)) return { kind: 'success', label: 'TikTok confirmou' }
  if (results.some(r => r.ok === false)) return { kind: 'error', label: results.some(r => r.ok) ? 'Envio parcial' : 'Envio falhou' }
  if (/erro|falh|rejeit|sem pixel|bloque/.test(status)) return { kind: 'error', label: /sem pixel/.test(status) ? 'Sem pixel de destino' : 'Falha no processamento' }
  return { kind: 'neutral', label: 'Envio não confirmado' }
}

export function conversionAmount(row: ConversionLogRow) {
  if (row.amount == null || row.amount === '') return '—'
  const value = Number(row.amount)
  if (!Number.isFinite(value)) return '—'
  const currency = String(row.currency || '').toUpperCase()
  if (!/^[A-Z]{3}$/.test(currency)) return 'Moeda não informada'
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(value / 100) } catch { return '—' }
}

export function conversionEvent(event?: string) {
  const labels: Record<string, string> = { Purchase: 'Compra', CompletePayment: 'Compra', ViewContent: 'Visita', AddToCart: 'Carrinho', InitiateCheckout: 'Checkout', AddPaymentInfo: 'Pagamento iniciado', Refund: 'Reembolso', Dispute: 'Disputa', Failed: 'Pagamento recusado' }
  return labels[event || ''] || event || 'Evento recebido'
}
