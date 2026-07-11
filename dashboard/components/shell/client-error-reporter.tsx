'use client'

// Item 561: erros de front reportados ao backend (/api/client-error).
// Sem isso, um crash no navegador do operador é invisível — o painel "só não
// funciona" e ninguém fica sabendo. Captura window.onerror + unhandledrejection,
// deduplica por mensagem (evita flood de um erro em loop de render) e envia
// via sendBeacon (sobrevive a unload; text/plain evita preflight CORS).

import { useEffect } from 'react'

const seen = new Set<string>()

function report(message: string, stack?: string) {
  const key = message.slice(0, 120)
  if (!message || seen.has(key) || seen.size >= 10) return // máx 10 erros distintos por sessão
  seen.add(key)
  const payload = JSON.stringify({
    message: message.slice(0, 300),
    stack: (stack || '').slice(0, 800),
    url: window.location.pathname,
  })
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/client-error', new Blob([payload], { type: 'text/plain' }))
    } else {
      fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
    }
  } catch {
    /* reporter nunca pode quebrar o app */
  }
}

export function ClientErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      report(e.message || 'Erro desconhecido', e.error?.stack)
    }
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason
      report(
        r instanceof Error ? `Unhandled rejection: ${r.message}` : `Unhandled rejection: ${String(r).slice(0, 200)}`,
        r instanceof Error ? r.stack : undefined,
      )
    }
    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])
  return null
}
