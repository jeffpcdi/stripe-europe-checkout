'use client'

// Copiloto de tráfego (IA) — chat sobre os dados REAIS da conta (espelho Neon
// + vendas dos gateways). A IA nunca executa nada: as tools propose_* viram
// cards de aprovação aqui, e só o clique em "Aprovar" chama
// POST /api/ads/copilot/execute (que valida tudo de novo no servidor).

import { useEffect, useRef, useState } from 'react'
import { Bot, Send, Loader2, Check, X, Wrench, Sparkles } from 'lucide-react'
import { copilotSend, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import { GlassCard } from '@/components/glass-card'
import { cn } from '@/lib/utils'
import type { CopilotEvent, ProposedAction } from '@/lib/types'

interface ChatMsg {
  role: 'user' | 'assistant'
  text: string
  actions: ProposedAction[]
  toolsUsed: string[]
}

const ACTION_LABEL: Record<ProposedAction['type'], string> = {
  pause: 'Pausar campanhas',
  activate: 'Reativar campanhas',
  budget: 'Ajustar orçamento',
  create_rule: 'Criar regra de automação',
}

// Card de aprovação de uma proposta da IA (o único caminho para executar algo)
function ActionCard({
  action,
  adAccountId,
  onDone,
}: {
  action: ProposedAction
  adAccountId: string
  onDone: () => void
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'rejected'>('idle')

  async function approve() {
    setState('running')
    try {
      const res = await apiSend<{ ok?: boolean; dryRun?: boolean }>('/api/ads/copilot/execute', 'POST', {
        action,
        adAccountId,
      })
      setState('done')
      toast.success(res.dryRun ? 'Simulado (modo dry-run ativo)' : 'Ação executada')
      onDone()
    } catch (e) {
      setState('idle')
      toast.error('Falha ao executar', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-brand-cyan/30 bg-[var(--accent-light)] p-3">
      <div className="flex items-center gap-2">
        <Sparkles className="size-3.5 shrink-0 text-brand-cyan" aria-hidden="true" />
        <p className="text-xs font-semibold text-foreground">{ACTION_LABEL[action.type]}</p>
      </div>
      <p className="mt-1 text-pretty text-xs leading-relaxed text-muted-foreground">{action.summary}</p>
      {action.type === 'budget' && action.params.budget != null && (
        <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground">
          Campanha {action.params.campaignId} → orçamento diário {action.params.budget}
        </p>
      )}
      {(action.type === 'pause' || action.type === 'activate') && (
        <p className="mt-1 font-mono text-[11px] tabular-nums text-foreground">
          {action.params.campaignIds?.length} campanha(s): {action.params.campaignIds?.join(', ')}
        </p>
      )}
      <div className="mt-2 flex items-center gap-2">
        {state === 'done' ? (
          <span className="flex items-center gap-1 text-[11px] font-medium text-success">
            <Check className="size-3" aria-hidden="true" /> Executada
          </span>
        ) : state === 'rejected' ? (
          <span className="text-[11px] text-muted-foreground">Descartada</span>
        ) : (
          <>
            <button
              type="button"
              className="btn-primary px-3 py-1 text-[11px]"
              disabled={state === 'running'}
              onClick={approve}
            >
              {state === 'running' ? (
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              ) : (
                <Check className="size-3" aria-hidden="true" />
              )}
              Aprovar
            </button>
            <button
              type="button"
              className="btn-ghost px-3 py-1 text-[11px]"
              disabled={state === 'running'}
              onClick={() => setState('rejected')}
            >
              <X className="size-3" aria-hidden="true" />
              Descartar
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const SUGGESTIONS = [
  'Como foi o desempenho dos últimos 7 dias?',
  'Qual campanha tem o melhor ROAS real?',
  'Alguma campanha gastando sem converter?',
]

export function CopilotPanel({
  active,
  adAccountId,
  currency,
  aiEnabled,
  onMutateTree,
}: {
  active: boolean
  adAccountId: string
  currency: string
  aiEnabled: boolean
  onMutateTree: () => void
}) {
  const [messages, setMessages] = useState<ChatMsg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const sessionId = useRef(`s-${Date.now().toString(36)}`)
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // autoscroll para a última mensagem
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  // cancela o stream se o painel desmontar no meio de uma resposta
  useEffect(() => () => abortRef.current?.abort(), [])

  if (!active || !aiEnabled) return null

  async function send(text: string) {
    const message = text.trim()
    if (!message || busy) return
    setInput('')
    setBusy(true)
    setExpanded(true)
    setMessages((prev) => [
      ...prev,
      { role: 'user', text: message, actions: [], toolsUsed: [] },
      { role: 'assistant', text: '', actions: [], toolsUsed: [] },
    ])
    const ac = new AbortController()
    abortRef.current = ac
    try {
      await copilotSend(
        { message, sessionId: sessionId.current, adAccountId, currency },
        (ev: CopilotEvent) => {
          setMessages((prev) => {
            const next = [...prev]
            const last = { ...next[next.length - 1] }
            if (ev.type === 'text') last.text += ev.text
            else if (ev.type === 'tool') last.toolsUsed = [...last.toolsUsed, ev.name]
            else if (ev.type === 'action') last.actions = [...last.actions, ev.action]
            else if (ev.type === 'error') last.text += (last.text ? '\n\n' : '') + `Erro: ${ev.error}`
            next[next.length - 1] = last
            return next
          })
        },
        ac.signal,
      )
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        setMessages((prev) => {
          const next = [...prev]
          const last = { ...next[next.length - 1] }
          last.text = last.text || `Erro: ${e instanceof Error ? e.message : 'falha na conexão'}`
          next[next.length - 1] = last
          return next
        })
      }
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  return (
    <GlassCard className="p-4">
      <button
        type="button"
        className="flex w-full items-center gap-2 text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="flex size-7 items-center justify-center rounded-lg bg-[var(--accent-light)] text-brand-cyan">
          <Bot className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Copiloto de tráfego</p>
          <p className="truncate text-[11px] text-muted-foreground">
            Pergunte sobre suas campanhas — respostas com dados reais, ações só com sua aprovação
          </p>
        </div>
        <span className="text-[11px] text-muted-foreground">{expanded ? 'Recolher' : 'Abrir'}</span>
      </button>

      {expanded && (
        <div className="mt-3 flex flex-col gap-3">
          {/* Histórico */}
          {messages.length > 0 && (
            <div ref={scrollRef} className="flex max-h-80 flex-col gap-3 overflow-y-auto pr-1" aria-live="polite">
              {messages.map((m, i) => (
                <div key={i} className={cn('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                  <div
                    className={cn(
                      'max-w-[92%] rounded-xl px-3 py-2 text-xs leading-relaxed',
                      m.role === 'user'
                        ? 'bg-[var(--accent-light)] text-foreground'
                        : 'border border-border/60 bg-background/40 text-foreground',
                    )}
                  >
                    {m.toolsUsed.length > 0 && (
                      <p className="mb-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                        <Wrench className="size-3" aria-hidden="true" />
                        {[...new Set(m.toolsUsed)].join(' · ')}
                      </p>
                    )}
                    <p className="whitespace-pre-wrap">
                      {m.text || (m.role === 'assistant' && busy && i === messages.length - 1 ? 'Analisando…' : m.text)}
                    </p>
                    {m.actions.map((a, j) => (
                      <ActionCard key={j} action={a} adAccountId={adAccountId} onDone={onMutateTree} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sugestões (só antes da primeira pergunta) */}
          {messages.length === 0 && (
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="btn-ghost px-2.5 py-1 text-[11px]" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Entrada */}
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // IME CJK: Enter confirmando composição não deve enviar
                if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
              }}
              placeholder="Ex.: qual campanha devo escalar?"
              className="input-neon min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-xs text-foreground"
              disabled={busy}
              aria-label="Pergunta para o copiloto"
            />
            <button
              type="submit"
              className="btn-primary shrink-0 px-3 py-2"
              disabled={busy || !input.trim()}
              aria-label="Enviar"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </form>
        </div>
      )}
    </GlassCard>
  )
}
