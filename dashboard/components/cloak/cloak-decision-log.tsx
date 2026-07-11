'use client'

// Item 170: histórico das últimas decisões de UM link de cloaking (offer/white
// + score + motivo), com IP MASCARADO pelo backend (observabilidade sem PII).
// Item 171: cada linha traz "reexecutar julgamento" — re-roda o judge deste link
// com o request ATUAL do admin (mesma rota /api/cloak/test) para depurar por que
// um visitante caiu na white/offer. Não é um replay do visitante histórico (não
// guardamos PII para isso); é o mesmo veredito que a rota real daria agora.

import { useState } from 'react'
import { Loader2, RefreshCw, Target, ShieldCheck } from 'lucide-react'
import { useCloakDecisions, apiSend } from '@/lib/api'
import type { CloakDecisionRow, CloakTestResult } from '@/lib/types'
import { toast } from '@/lib/toast'

// Motivos do desvio à white em pt-BR (espelham os reasons de server.js)
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

function DecisionRow({ row, entryKey }: { row: CloakDecisionRow; entryKey: string }) {
  const [rerunning, setRerunning] = useState(false)
  const isOffer = row.decision === 'offer'

  // Item 171: reexecuta o julgamento deste link (request atual do admin)
  async function rerun() {
    // key pode ser "cloak:<slug>" (entry /c) — a rota de teste espera só o slug
    const slug = entryKey.startsWith('cloak:') ? entryKey.slice(6) : entryKey
    setRerunning(true)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST', { slug })
      toast.info(`Reexecução: ${r.verdict} · score ${r.score}/${r.threshold}`, {
        hint: 'Veredito do seu acesso agora — compare com a linha do histórico.',
      })
    } catch (err) {
      toast.error('Não foi possível reexecutar o julgamento.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setRerunning(false)
    }
  }

  return (
    <li className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-2.5 py-1.5 text-[11px]">
      <span
        className={`flex size-5 shrink-0 items-center justify-center rounded-full ${
          isOffer ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
        }`}
        aria-hidden="true"
      >
        {isOffer ? <Target className="size-3" /> : <ShieldCheck className="size-3" />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className={isOffer ? 'font-medium text-success' : 'font-medium text-warning'}>
            {isOffer ? 'offer' : 'white'}
          </span>
          {!isOffer && row.reason && (
            <span className="text-muted-foreground">{REASON_LABEL[row.reason] || row.reason}</span>
          )}
          {row.score != null && <span className="text-muted-foreground">score {row.score}</span>}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[10px] text-muted-foreground">
          <span>{fmtHora(row.at)}</span>
          {row.country && <span>{row.country}</span>}
          {row.ip && <span className="font-mono">{row.ip}</span>}
        </div>
      </div>
      <button
        type="button"
        onClick={rerun}
        disabled={rerunning}
        title="Reexecutar julgamento deste link com o seu acesso atual"
        className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
      >
        {rerunning ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
        Reexecutar
      </button>
    </li>
  )
}

export function CloakDecisionLog({ entryKey }: { entryKey: string }) {
  const { data, isLoading, mutate } = useCloakDecisions(entryKey)
  const log = data?.log ?? []

  return (
    <div className="mt-2 rounded-lg border border-border bg-background/40 p-2.5">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[11px] font-medium text-foreground">Últimas decisões</span>
        <button
          type="button"
          onClick={() => mutate()}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <RefreshCw className="size-3" /> Atualizar
        </button>
      </div>
      {isLoading && log.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">Carregando…</p>
      ) : log.length === 0 ? (
        <p className="py-3 text-center text-[11px] text-muted-foreground">
          Nenhuma decisão registrada ainda. Assim que o link receber acessos, as últimas aparecem aqui.
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {log.map((row, i) => (
            <DecisionRow key={`${row.at}-${i}`} row={row} entryKey={entryKey} />
          ))}
        </ul>
      )}
      <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
        IP anonimizado (último octeto oculto). Últimas {log.length || 0} decisões · retenção de 30 dias.
      </p>
    </div>
  )
}
