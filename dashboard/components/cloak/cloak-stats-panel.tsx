'use client'

import { useState } from 'react'
import { ChevronDown, RotateCcw } from 'lucide-react'
import { useCloakStats, apiSend } from '@/lib/api'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

// Rótulos amigáveis para os motivos de bloqueio do motor
const REASON_LABELS: Record<string, string> = {
  'bot-ua': 'Robô conhecido',
  pais: 'País bloqueado',
  idioma: 'Idioma bloqueado',
  score: 'Comportamento suspeito',
  'rate-limit': 'Muitas requisições',
  datacenter: 'Servidor de Nuvem',
  headless: 'Navegador invisível',
  webview: 'Navegador interno',
  'ttclid-replay': 'Clique repetido (anúncio)',
  sticky: 'Visitante já bloqueado',
  velocity: 'Automação detectada',
  mobile: 'Exigia celular',
  anuncio: 'Exigia anúncio',
}

// Item 144: mini-gráfico diário principal×seguro por link. Os dados internos
// continuam usando offer/white; a UI traduz os termos para linguagem operacional.
function DailyMiniChart({ daily }: { daily: { day: string; offer: number; white: number }[] }) {
  const days = daily.slice(-14)
  const max = Math.max(1, ...days.map((d) => d.offer + d.white))
  if (!days.some((d) => d.offer + d.white > 0)) return null

  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>Últimos {days.length} dias</span>
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" /> principal
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" /> seguro
          </span>
        </span>
      </div>
      <div
        className="flex h-12 items-end gap-0.5"
        role="img"
        aria-label="Gráfico diário de decisões entre destino principal e seguro"
      >
        {days.map((d) => {
          const total = d.offer + d.white
          const h = total ? Math.max(6, Math.round((total / max) * 100)) : 2
          const offerPct = total ? (d.offer / total) * 100 : 0
          // Item 236: fuso fixo de Brasília — d.day é 'YYYY-MM-DD' (UTC-naive).
          const label = new Date(d.day + 'T12:00:00Z').toLocaleDateString('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            day: '2-digit',
            month: '2-digit',
          })
          return (
            <div
              key={d.day}
              className="flex flex-1 flex-col justify-end"
              style={{ height: '100%' }}
              title={`${label}: ${d.offer} principal · ${d.white} seguro`}
            >
              <div className="flex w-full flex-col overflow-hidden rounded-[2px]" style={{ height: `${h}%` }}>
                <div className="w-full bg-warning" style={{ height: `${100 - offerPct}%` }} aria-hidden="true" />
                <div className="w-full bg-success" style={{ height: `${offerPct}%` }} aria-hidden="true" />
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function CloakStatsPanel() {
  const { data, mutate } = useCloakStats()
  // Item 184: confirmação destrutiva padronizada. `key: null` = zerar tudo;
  // string = zerar um link específico.
  const [resetting, setResetting] = useState<{ key: string | null; nome: string } | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const agg = data?.aggregate
  const links = data?.links ?? []
  const blockPct = agg && agg.total ? Math.round(agg.blockRate * 100) : 0

  async function confirmReset() {
    if (!resetting || resetBusy) return
    const target = resetting
    setResetBusy(true)
    let reset = false
    try {
      await apiSend('/api/cloak/stats/reset', 'POST', target.key ? { key: target.key } : {})
      reset = true
      setResetting(null)
      toast.success(target.key ? `Contadores de "${target.nome}" zerados.` : 'Todos os contadores zerados.')
    } catch (err) {
      toast.error('Falha ao zerar os contadores.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setResetBusy(false)
    }
    if (reset) {
      try {
        await mutate()
      } catch (error) {
        toast.info('Contadores zerados, mas os números da tela não atualizaram completamente', {
          hint: error instanceof Error ? error.message : undefined,
        })
      }
    }
  }

  const reasonsSorted = agg ? Object.entries(agg.reasons).sort((a, b) => b[1] - a[1]) : []
  const activeLinks = links.filter((link) => link.total > 0).sort((a, b) => b.total - a.total)

  return (
    <section>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-foreground">Decisões de tráfego</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Acompanhe os acessos enviados ao destino principal ou à página segura.
          </p>
          {data && (
            <p
              className={`mt-2 flex items-center gap-1.5 text-xs ${data.redis ? 'text-success' : 'text-warning'}`}
              title={data.redis ? 'Contadores duráveis (Redis)' : 'Contadores em memória — zeram se o servidor reiniciar'}
            >
              <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
              {data.redis ? 'Contadores duráveis' : 'Contadores em memória'}
            </p>
          )}
        </div>

        {agg && agg.total > 0 && (
          <button
            type="button"
            onClick={() => setResetting({ key: null, nome: 'todos os links' })}
            className="flex min-h-9 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" /> Zerar tudo
          </button>
        )}
      </div>

      {agg && agg.total > 0 ? (
        <>
          <div className="mt-5 grid grid-cols-3 divide-x divide-border/60 border-y border-border/60 py-4">
            <div className="min-w-0 pr-3 sm:pr-5">
              <p className="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{agg.offer.toLocaleString('pt-BR')}</p>
              <p className="mt-1 text-xs text-muted-foreground sm:text-[13px]">Destino principal</p>
            </div>
            <div className="min-w-0 px-3 sm:px-5">
              <p className="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{agg.white.toLocaleString('pt-BR')}</p>
              <p className="mt-1 text-xs text-warning sm:text-[13px]">Destino seguro</p>
            </div>
            <div className="min-w-0 pl-3 sm:pl-5">
              <p className="text-xl font-semibold tabular-nums text-foreground sm:text-2xl">{blockPct}%</p>
              <p className="mt-1 text-xs text-muted-foreground sm:text-[13px]">Bloqueado</p>
            </div>
          </div>

          {reasonsSorted.length > 0 && (
            <section className="mt-6">
              <h3 className="text-sm font-semibold text-foreground">Motivos de bloqueio</h3>
              <div className="mt-2 grid grid-cols-1 gap-x-8 sm:grid-cols-2">
                {reasonsSorted.map(([reason, count]) => (
                  <div key={reason} className="flex items-center justify-between gap-4 border-b border-border/45 py-2.5 text-[13px]">
                    <span className="min-w-0 text-muted-foreground">{REASON_LABELS[reason] ?? reason}</span>
                    <span className="shrink-0 font-medium tabular-nums text-foreground">{count.toLocaleString('pt-BR')}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      ) : (
        <div className="py-10 text-center">
          <p className="text-sm font-medium text-foreground">Sem decisões registradas ainda.</p>
          <p className="mt-1 text-sm text-muted-foreground">Os resultados aparecem quando o tráfego chega aos links protegidos.</p>
        </div>
      )}

      {/* Item 209: challenge JS nunca coletado — mantém aviso operacional porque
          as camadas D–H ficam inertes sem o snippet. */}
      {agg && agg.total > 0 && data?.challenge && data.challenge.beacons === 0 && (
        <div
          className="mt-5 border-y border-warning/25 py-3 text-[13px] leading-relaxed"
          title={'Sem o snippet, as camadas de WebGL, fuso horário, comportamento e entropia ficam desligadas e o julgamento usa só rede e cabeçalhos. Instale <script src="https://SEU-DOMINIO/t.js" defer></script> no <head> das páginas de destino.'}
        >
          <p className="font-medium text-warning">
            Proteção reduzida · <code className="font-mono text-[12px]">/t.js</code> não detectado nas páginas de destino.
          </p>
          <p className="mt-0.5 text-muted-foreground">WebGL, fuso horário, comportamento e entropia não estão sendo coletados.</p>
        </div>
      )}

      {/* Itens 201/202/203: ferramentas avançadas continuam recolhidas para não
          competir com os resultados operacionais. */}
      {(data?.sticky?.available || (data?.ttclidReplays ?? 0) > 0) && (
        <details className="group mt-6 border-y border-border/60">
          <summary className="flex cursor-pointer select-none items-center justify-between gap-4 py-3 text-[13px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20 [&::-webkit-details-marker]:hidden">
            <span className="font-medium text-foreground">Ferramentas</span>
            <span className="flex min-w-0 items-center gap-2 text-right text-xs text-muted-foreground">
              <span className="hidden flex-wrap justify-end gap-x-3 gap-y-1 sm:flex">
                {data?.sticky?.available && (
                  <span>{data.sticky.count.toLocaleString('pt-BR')}{data.sticky.truncated ? '+' : ''} em cache</span>
                )}
                {(data?.ttclidReplays ?? 0) > 0 && <span>{(data?.ttclidReplays ?? 0).toLocaleString('pt-BR')} replays</span>}
                {(agg?.reasons?.velocity ?? 0) > 0 && <span>{(agg?.reasons?.velocity ?? 0).toLocaleString('pt-BR')} automações</span>}
              </span>
              <ChevronDown className="size-3.5 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
            </span>
          </summary>

          <div className="border-t border-border/50 py-4">
            <div className="grid gap-5 lg:grid-cols-3">
              {data?.sticky?.available && (
                <section className="min-w-0">
                  <h4 className="text-sm font-medium text-foreground">Reavaliar visitante</h4>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Limpe o veredito em cache para que o próximo acesso desse visitante seja analisado novamente.
                  </p>
                  <form
                    className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row"
                    onSubmit={(e) => {
                      e.preventDefault()
                      const form = e.currentTarget
                      const input = form.elements.namedItem('vid') as HTMLInputElement
                      const vid = input.value.trim()
                      if (!vid) return
                      apiSend('/api/cloak/sticky/clear', 'POST', { vid })
                        .then((r: unknown) => {
                          const ok = (r as { cleared?: boolean }).cleared
                          toast[ok ? 'success' : 'info'](ok ? 'Veredito limpo — o próximo acesso deste visitante será julgado de novo.' : 'Nenhum veredito em cache para este v_id.')
                          input.value = ''
                          mutate()
                        })
                        .catch((err: unknown) => toast.error('Falha ao limpar o veredito.', { hint: err instanceof Error ? err.message : undefined }))
                    }}
                  >
                    <input
                      name="vid"
                      type="text"
                      placeholder="v_id do visitante"
                      className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-secondary/25 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/15"
                      aria-label="v_id do visitante para limpar o veredito de bot"
                    />
                    <button type="submit" className="h-10 shrink-0 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary">
                      Limpar veredito
                    </button>
                  </form>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    O cache guarda apenas vereditos de bot e expira sozinho. Use esta ação quando um visitante legítimo tiver sido classificado incorretamente.
                  </p>
                </section>
              )}

              <section className="min-w-0">
                <h4 className="text-sm font-medium text-foreground">Refazer identificação de rede</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Limpe o cache de infraestrutura para repetir a identificação ASN no próximo acesso.
                </p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const form = e.currentTarget
                    const input = form.elements.namedItem('ip') as HTMLInputElement
                    const ip = input.value.trim()
                    if (!ip) return
                    apiSend('/api/cloak/asn/clear', 'POST', { ip })
                      .then((r: unknown) => {
                        const ok = (r as { cleared?: boolean }).cleared
                        toast[ok ? 'success' : 'info'](
                          ok
                            ? 'Cache de infraestrutura limpo — o próximo acesso deste IP refaz o lookup.'
                            : 'Nenhum cache de infraestrutura para este IP.',
                        )
                        input.value = ''
                      })
                      .catch((err: unknown) =>
                        toast.error('Falha ao limpar o cache de infraestrutura.', {
                          hint: err instanceof Error ? err.message : undefined,
                        }),
                      )
                  }}
                >
                  <input
                    name="ip"
                    type="text"
                    placeholder="Endereço IP"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-secondary/25 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/15"
                    aria-label="IP para limpar o cache de ASN"
                  />
                  <button type="submit" className="h-10 shrink-0 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary">
                    Refazer lookup
                  </button>
                </form>
              </section>

              <section className="min-w-0">
                <h4 className="text-sm font-medium text-foreground">Liberar limite de acessos</h4>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Use quando visitantes legítimos no mesmo IP ou rede atingirem o limite atual.
                </p>
                <form
                  className="mt-3 flex flex-col gap-2 sm:flex-row lg:flex-col xl:flex-row"
                  onSubmit={(e) => {
                    e.preventDefault()
                    const form = e.currentTarget
                    const input = form.elements.namedItem('velip') as HTMLInputElement
                    const ip = input.value.trim()
                    if (!ip) return
                    apiSend('/api/cloak/velocity/clear', 'POST', { ip })
                      .then((r: unknown) => {
                        const n = (r as { cleared?: number }).cleared ?? 0
                        toast[n > 0 ? 'success' : 'info'](
                          n > 0
                            ? 'IP liberado do limite de acessos — a contagem recomeça do zero.'
                            : 'Este IP não está em nenhuma contagem de acessos no momento.',
                        )
                        input.value = ''
                      })
                      .catch((err: unknown) =>
                        toast.error('Falha ao liberar o IP do limite de acessos.', {
                          hint: err instanceof Error ? err.message : undefined,
                        }),
                      )
                  }}
                >
                  <input
                    name="velip"
                    type="text"
                    placeholder="Endereço IP"
                    className="h-10 min-w-0 flex-1 rounded-lg border border-border bg-secondary/25 px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/70 focus:ring-2 focus:ring-brand-cyan/15"
                    aria-label="IP para liberar do limite de acessos por velocity"
                  />
                  <button type="submit" className="h-10 shrink-0 rounded-lg border border-border px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-secondary">
                    Liberar IP
                  </button>
                </form>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                  A contagem expira sozinha ao fim da janela. Libere manualmente apenas quando um visitante legítimo precisar tentar novamente agora.
                </p>
              </section>
            </div>
          </div>
        </details>
      )}

      {activeLinks.length > 0 && (
        <section className="mt-7">
          <h3 className="text-sm font-semibold text-foreground">Resultados por link</h3>
          <ul className="mt-2 divide-y divide-border/55 border-y border-border/55">
            {activeLinks.map((link) => {
              const pct = link.total ? Math.round(link.blockRate * 100) : 0
              return (
                <li key={link.tipo + link.slug} className="py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{link.tipo === 'cloak' ? '/c' : '/go'}</span>
                      <span className="truncate text-[13px] font-medium text-foreground">{link.nome}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setResetting({ key: link.tipo === 'cloak' ? 'cloak:' + link.slug : link.slug, nome: link.nome })}
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25"
                      aria-label={`Zerar ${link.nome}`}
                    >
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:text-[13px]">
                    <span><span className="font-medium tabular-nums text-foreground">{link.offer.toLocaleString('pt-BR')}</span> principal</span>
                    <span><span className="font-medium tabular-nums text-foreground">{link.white.toLocaleString('pt-BR')}</span> seguro</span>
                    <span className="sm:ml-auto"><span className="font-medium tabular-nums text-foreground">{pct}%</span> bloqueado</span>
                  </div>

                  <div className="mt-2 flex h-0.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-success" style={{ width: `${100 - pct}%` }} aria-hidden="true" />
                    <div className="bg-warning" style={{ width: `${pct}%` }} aria-hidden="true" />
                  </div>

                  {Array.isArray(link.daily) && <DailyMiniChart daily={link.daily} />}
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={Boolean(resetting)}
        title={resetting?.key ? `Zerar contadores de "${resetting.nome}"?` : 'Zerar TODOS os contadores?'}
        description={
          resetting?.key ? (
            <>As decisões de destino principal/seguro registradas deste link serão apagadas. Esta ação não pode ser desfeita.</>
          ) : (
            <>Todos os contadores de cloaking de todos os links serão apagados. Esta ação não pode ser desfeita.</>
          )
        }
        confirmLabel="Zerar"
        tone="danger"
        appearance="quiet"
        busy={resetBusy}
        onConfirm={confirmReset}
        onClose={() => setResetting(null)}
      />
    </section>
  )
}
