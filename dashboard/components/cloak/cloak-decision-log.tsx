'use client'

// Histórico operacional das últimas decisões de uma campanha de Cloaker.
// O backend mascara o IP e, para campanhas V2, usa campaignId como identidade estável.

import { useState } from 'react'
import { ChevronDown, Loader2, RefreshCw, X } from 'lucide-react'
import { useCloakDecisions, apiSend } from '@/lib/api'
import type { CloakDecisionRow, CloakTestResult } from '@/lib/types'
import { toast } from '@/lib/toast'
import { describeSignal } from './signal-labels'

const REASON_LABEL: Record<string, string> = {
  'bot-ua': 'robô conhecido (user-agent)',
  sticky: 'já reprovado antes (sticky)',
  mobile: 'não é celular',
  anuncio: 'sem prova de clique no anúncio',
  'ttclid-replay': 'ttclid reusado de outro contexto',
  velocity: 'acessos rápidos demais (automação)',
  pais: 'país fora da lista',
  idioma: 'idioma fora da lista',
  score: 'score de robô acima do limite',
}

function fmtHora(ms: number): string {
  try {
    return new Date(ms).toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return ''
  }
}

function verdictLabel(verdict: CloakTestResult['verdict']): string {
  if (verdict === 'real') return 'Destino principal'
  if (verdict === 'bot') return 'Destino seguro'
  return 'Falha no teste'
}

function DecisionRow({ row, entryKey }: { row: CloakDecisionRow; entryKey: string }) {
  const [rerunning, setRerunning] = useState(false)
  const isOffer = row.decision === 'offer'
  const signals = Array.isArray(row.signals) ? row.signals : []

  async function rerun() {
    const isCampaign = entryKey.startsWith('campaign:')
    const slug = entryKey.startsWith('cloak:') ? entryKey.slice(6) : ''
    const campaignId = isCampaign ? entryKey.slice('campaign:'.length) : ''
    setRerunning(true)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST', {
        slug: slug || undefined,
        campaignId: campaignId || undefined,
      })
      toast.info(`Teste atual: ${verdictLabel(r.verdict)} · score ${r.score}/${r.threshold}`, {
        hint: 'O teste usa seu acesso atual; ele não reproduz o visitante histórico.',
      })
    } catch (err) {
      toast.error('Não foi possível testar a campanha com seu acesso.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setRerunning(false)
    }
  }

  return (
    <li className="py-3.5 first:pt-0 last:pb-0">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className={`size-1.5 shrink-0 rounded-full ${isOffer ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
            <span className="text-sm font-medium text-foreground">
              {isOffer ? 'Destino principal' : 'Destino seguro'}
            </span>
            {row.score != null && (
              <span className="text-xs tabular-nums text-muted-foreground">Score {row.score}</span>
            )}
          </div>

          {!isOffer && row.reason && (
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              <span className="text-foreground/80">Motivo · </span>
              {REASON_LABEL[row.reason] || row.reason}
            </p>
          )}

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
            <span>{fmtHora(row.at)}</span>
            {row.country && <span>{row.country}</span>}
            {row.ip && <span className="font-mono">{row.ip}</span>}
          </div>

          {(row.country || row.ip) && (
            <div className="mt-1 hidden flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:flex">
              {row.country && <span>{row.country}</span>}
              {row.country && row.ip && <span aria-hidden="true">·</span>}
              {row.ip && <span className="font-mono">{row.ip}</span>}
            </div>
          )}

          {signals.length > 0 && (
            <details className="group mt-2.5">
              <summary className="flex w-fit cursor-pointer list-none items-center gap-1.5 rounded text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
                <span>Sinais da decisão · {signals.length}</span>
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <ul className="mt-2 space-y-1.5 border-l border-border/60 pl-3">
                {signals.map((signal, index) => {
                  const info = describeSignal(signal)
                  return (
                    <li
                      key={`${signal}-${index}`}
                      title={signal}
                      className={`text-xs leading-relaxed ${
                        info.kind === 'confiavel'
                          ? 'text-success'
                          : info.kind === 'suspeito'
                            ? 'text-warning'
                            : 'text-muted-foreground'
                      }`}
                    >
                      {info.label}
                    </li>
                  )
                })}
              </ul>
            </details>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 sm:flex-col sm:items-end">
          <span className="hidden text-xs text-muted-foreground sm:block">{fmtHora(row.at)}</span>
          <button
            type="button"
            onClick={rerun}
            disabled={rerunning}
            title="Testar esta campanha com o seu acesso atual"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20 disabled:opacity-50"
          >
            {rerunning && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
            Testar com meu acesso
          </button>
        </div>
      </div>
    </li>
  )
}

export function CloakDecisionLog({ entryKey, onClose }: { entryKey: string; onClose?: () => void }) {
  const { data, isLoading, mutate } = useCloakDecisions(entryKey)
  const log = data?.log ?? []
  const durable = data?.source === 'redis'

  return (
    <section className="mt-3 border-t border-border/60 pt-4" aria-label="Histórico de decisões">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Histórico de decisões</h3>
          {data?.source && (
            <p className={`mt-1 flex items-center gap-1.5 text-xs ${durable ? 'text-success' : 'text-warning'}`}>
              <span className={`size-1.5 rounded-full ${durable ? 'bg-success' : 'bg-warning'}`} aria-hidden="true" />
              {durable ? 'Histórico durável' : 'Histórico temporário'}
            </p>
          )}
          {!durable && data?.source === 'memory' && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Este histórico está em memória e pode ser perdido em reinícios.
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Atualizar
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20"
              aria-label="Fechar histórico"
            >
              <X className="size-3.5" aria-hidden="true" />
              Fechar
            </button>
          )}
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        O novo teste usa seu acesso atual; ele não reproduz o visitante histórico.
      </p>

      <div className="mt-4">
        {isLoading && log.length === 0 ? (
          <p className="py-3 text-xs text-muted-foreground">Carregando histórico…</p>
        ) : log.length === 0 ? (
          <div className="py-3">
            <p className="text-sm font-medium text-foreground">Nenhuma decisão registrada ainda.</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              A atividade aparecerá aqui quando esta campanha receber acessos.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {log.map((row, i) => (
              <DecisionRow key={`${row.at}-${i}`} row={row} entryKey={entryKey} />
            ))}
          </ul>
        )}
      </div>

      {data?.source && (
        <p className="mt-4 border-t border-border/60 pt-3 text-xs leading-relaxed text-muted-foreground">
          {durable
            ? 'IPs anonimizados · até 50 decisões por campanha · retenção de 30 dias.'
            : 'IPs anonimizados · até 50 decisões nesta instância · histórico perdido em reinícios.'}
        </p>
      )}
    </section>
  )
}
