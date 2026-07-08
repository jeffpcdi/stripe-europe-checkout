'use client'

import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { CloakConfigPanel } from './cloak-config-panel'
import { CloakStatsPanel } from './cloak-stats-panel'
import { CloakEntriesPanel } from './cloak-entries-panel'

export function CloakView() {
  return (
    <div className="flex flex-col gap-6">
      <CloakStatsPanel />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CloakConfigPanel />
        <CloakTestPanel />
      </div>

      <CloakEntriesPanel />
    </div>
  )
}

function CloakTestPanel() {
  const [result, setResult] = useState<CloakTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function runTest() {
    setLoading(true)
    setError(null)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST', {})
      setResult(r)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no teste')
    } finally {
      setLoading(false)
    }
  }

  const isBlocked = result && result.score >= result.threshold

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Teste ao vivo</h2>
          <p className="text-xs text-muted-foreground">Julga a requisição atual deste navegador</p>
        </div>
        <button
          type="button"
          onClick={runTest}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
          Rodar teste
        </button>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!result && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Rode o teste para ver como o cloaker classificaria seu acesso.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-4">
            <div>
              <p className="text-xs text-muted-foreground">Veredito</p>
              <p className="text-lg font-bold text-foreground">
                {isBlocked ? 'Página branca' : 'Offer liberada'}
              </p>
            </div>
            <StatusBadge status={isBlocked ? 'error' : 'success'}>
              score {result.score} / {result.threshold}
            </StatusBadge>
          </div>

          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-muted-foreground">IP</span>
              <span className="font-mono text-foreground">{result.ip || '—'}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-muted-foreground">UA</span>
              <span className="break-all font-mono text-foreground">{result.ua || '—'}</span>
            </div>
          </div>

          {result.signals?.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sinais detectados</p>
              <div className="flex flex-wrap gap-1.5">
                {result.signals.map((s, i) => (
                  <span
                    key={i}
                    className="rounded-md bg-destructive/15 px-2 py-0.5 font-mono text-[11px] text-destructive"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
