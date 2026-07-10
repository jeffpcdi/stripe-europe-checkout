'use client'

import { useState } from 'react'
import { FlaskConical, Loader2 } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { CloakConfigPanel } from './cloak-config-panel'
import { CloakStatsPanel } from './cloak-stats-panel'
import { CloakEntriesPanel } from './cloak-entries-panel'
import { describeSignal } from './signal-labels'

const CLOAK_STEPS: TutorialStep[] = [
  {
    title: 'O que o cloaker faz',
    body: (
      <>
        Ele decide, a cada acesso, quem vê a <strong>página segura</strong> (white page) e quem vê a{' '}
        <strong>oferta real</strong>. Robôs de revisão, bots e acessos suspeitos ficam na página segura;
        o comprador real passa para a oferta.
      </>
    ),
    tip: 'Isso protege a conta de anúncios de reprovações por revisar a oferta diretamente.',
  },
  {
    title: 'Como pontua o acesso',
    body: (
      <>
        Cada acesso ganha um <strong>score</strong> a partir de sinais (data center, robôs conhecidos,
        país fora do alvo, comportamento de automação…). Se o score passa do <strong>limiar</strong>, o
        acesso é bloqueado e vê a white page.
      </>
    ),
  },
  {
    title: 'Configuração e entradas',
    body: (
      <>
        No painel de <strong>configuração</strong> você ajusta o limiar e as regras. Em{' '}
        <strong>entradas</strong>, define páginas branca/oferta e segmentação por país. Comece com o
        preset padrão — ele já é seguro.
      </>
    ),
  },
  {
    title: 'Teste antes de subir',
    body: (
      <>
        Use o <strong>Teste ao vivo</strong> para ver como o cloaker classificaria o seu próprio acesso,
        com o score e os sinais detectados. Assim você valida a regra sem gastar clique de anúncio.
      </>
    ),
  },
]

export function CloakView() {
  const [showTutorial, setShowTutorial] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground text-pretty">
          Proteja sua oferta: robôs veem a página segura, compradores veem a oferta real.
        </p>
        <TutorialButton onClick={() => setShowTutorial(true)} />
      </div>

      <CloakStatsPanel />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <CloakConfigPanel />
        <CloakTestPanel />
      </div>

      <CloakEntriesPanel />

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como funciona o cloaker"
        steps={CLOAK_STEPS}
      />
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
          <h2 className="section-head text-sm font-semibold text-foreground">Teste ao vivo</h2>
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
              <p className="label-mono">Veredito</p>
              <p className="text-lg font-semibold text-foreground">
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
              {/* Legendas pt-BR: verde = indica humano real, vermelho = suspeito,
                  cinza = informativo. O código técnico fica no title (hover). */}
              <ul className="flex flex-wrap gap-1.5">
                {result.signals.map((s, i) => {
                  const info = describeSignal(s)
                  const cls =
                    info.kind === 'confiavel'
                      ? 'bg-[var(--success-light)] text-success'
                      : info.kind === 'suspeito'
                        ? 'bg-destructive/15 text-destructive'
                        : 'bg-secondary text-muted-foreground'
                  return (
                    <li key={i}>
                      <span title={s} className={`inline-block rounded-md px-2 py-0.5 text-[11px] ${cls}`}>
                        {info.label}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
