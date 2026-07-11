'use client'

import { useState } from 'react'
import { Filter, RotateCcw, ShieldCheck, Target } from 'lucide-react'
import { useCloakStats, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

// Rótulos amigáveis para os motivos de bloqueio do motor
const REASON_LABELS: Record<string, string> = {
  'bot-ua': 'UA de bot',
  pais: 'país fora da lista',
  idioma: 'idioma bloqueado',
  score: 'score alto',
  'rate-limit': 'rate-limit',
  datacenter: 'datacenter',
  headless: 'headless',
  webview: 'webview',
  // Item 203: replay de ttclid — revisor copiou uma URL capturada e o clique
  // reapareceu com contexto divergente (IP/UA diferente do primeiro uso)
  'ttclid-replay': 'link de anúncio reusado (replay)',
  // Itens 201/202: veredito sticky — visitante já marcado como bot nas últimas 6h
  sticky: 'já marcado como bot (cache 6h)',
  velocity: 'muitos acessos do mesmo IP',
  mobile: 'exigia celular',
  anuncio: 'exigia clique de anúncio',
}

// Item 144: mini-gráfico diário offer×white por link (o backend já devolve
// `daily`, mas nunca era plotado). Barras verticais empilhadas com os mesmos
// tokens das barras agregadas — offer (verde) embaixo, white (âmbar) em cima.
function DailyMiniChart({ daily }: { daily: { day: string; offer: number; white: number }[] }) {
  const days = daily.slice(-14) // últimas 2 semanas
  const max = Math.max(1, ...days.map((d) => d.offer + d.white))
  if (!days.some((d) => d.offer + d.white > 0)) return null
  return (
    <div className="mt-2.5">
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>Últimos {days.length} dias</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-success" aria-hidden="true" /> offer
          </span>
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-warning" aria-hidden="true" /> white
          </span>
        </span>
      </div>
      <div className="flex h-12 items-end gap-0.5" role="img" aria-label="Gráfico diário de decisões offer contra white page">
        {days.map((d) => {
          const total = d.offer + d.white
          const h = total ? Math.max(6, Math.round((total / max) * 100)) : 2
          const offerPct = total ? (d.offer / total) * 100 : 0
          // Item 236: fuso fixo de Brasília — d.day é 'YYYY-MM-DD' (UTC-naive);
          // sem timeZone o navegador do usuário poderia deslocar o dia.
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
              title={`${label}: ${d.offer} offer · ${d.white} white`}
            >
              <div className="flex w-full flex-col overflow-hidden rounded-sm" style={{ height: `${h}%` }}>
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
  // Item 184: confirmação destrutiva padronizada (substitui window.confirm).
  // `key: null` = zerar tudo; string = zerar um link específico.
  const [resetting, setResetting] = useState<{ key: string | null; nome: string } | null>(null)
  const [resetBusy, setResetBusy] = useState(false)

  const agg = data?.aggregate
  const links = data?.links ?? []
  const blockPct = agg && agg.total ? Math.round(agg.blockRate * 100) : 0

  async function confirmReset() {
    if (!resetting) return
    setResetBusy(true)
    try {
      await apiSend('/api/cloak/stats/reset', 'POST', resetting.key ? { key: resetting.key } : {})
      toast.success(resetting.key ? `Contadores de "${resetting.nome}" zerados.` : 'Todos os contadores zerados.')
      setResetting(null)
      mutate()
    } catch (err) {
      toast.error('Falha ao zerar os contadores.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setResetBusy(false)
    }
  }

  const reasonsSorted = agg
    ? Object.entries(agg.reasons).sort((a, b) => b[1] - a[1])
    : []

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-[10px] text-[color:var(--brand-cyan)]"
            style={{ background: 'color-mix(in oklab, var(--brand-cyan) 14%, transparent)' }}
            aria-hidden="true"
          >
            <Filter className="size-4" />
          </span>
          <div>
            <h2 className="section-head flex items-center gap-1.5 text-sm font-semibold text-foreground">
              Offer vs White
              {/* Item 221: fonte do dado — memória zera em reinícios */}
              {data && (
                <span
                  title={data.redis ? 'Contadores duráveis (Redis)' : 'Contadores em memória — zeram se o servidor reiniciar'}
                  className={`rounded px-1 py-px text-[9px] font-normal leading-4 ${
                    data.redis ? 'bg-[var(--success-light)] text-success' : 'bg-warning/15 text-warning'
                  }`}
                >
                  {data.redis ? 'durável' : 'memória'}
                </span>
              )}
            </h2>
            <p className="text-xs text-muted-foreground">Decisões do cloaker por link</p>
          </div>
        </div>
        {agg && agg.total > 0 && (
          <button
            type="button"
            onClick={() => setResetting({ key: null, nome: 'todos os links' })}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          >
            <RotateCcw className="size-3.5" /> Zerar tudo
          </button>
        )}
      </div>

      {/* Item 169: leitura de impacto em linguagem de negócio — traduz os
          contadores crus em "público real que viu a oferta" x "robôs/revisores
          barrados na white page", em vez de só offer/white numérico */}
      {agg && agg.total > 0 && (
        <div className="mb-4 grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-success/30 bg-success/10 p-3">
            <div className="flex items-center gap-1.5 text-success">
              <Target className="size-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium uppercase tracking-wide">Público real na oferta</span>
            </div>
            <p className="mt-1 text-xl font-semibold text-foreground">{agg.offer.toLocaleString('pt-BR')}</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              acessos que passaram no filtro e viram a offer
            </p>
          </div>
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <div className="flex items-center gap-1.5 text-warning">
              <ShieldCheck className="size-3.5" aria-hidden="true" />
              <span className="text-[11px] font-medium uppercase tracking-wide">Robôs/revisores barrados</span>
            </div>
            <p className="mt-1 text-xl font-semibold text-foreground">{agg.white.toLocaleString('pt-BR')}</p>
            <p className="text-[11px] leading-snug text-muted-foreground">
              enviados à white page e longe da sua oferta
            </p>
          </div>
        </div>
      )}

      {/* Barra agregada offer/white */}
      {agg && agg.total > 0 ? (
        <>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span className="text-success">Offer {agg.offer}</span>
            <span className="text-muted-foreground">{blockPct}% bloqueado</span>
            <span className="text-warning">White {agg.white}</span>
          </div>
          <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-muted">
            <div
              className="bg-success transition-all"
              style={{ width: `${100 - blockPct}%` }}
              aria-hidden="true"
            />
            <div className="bg-warning transition-all" style={{ width: `${blockPct}%` }} aria-hidden="true" />
          </div>

          {/* Motivos de bloqueio */}
          {reasonsSorted.length > 0 && (
            <div className="mb-4 flex flex-wrap gap-1.5">
              {reasonsSorted.map(([reason, count]) => (
                <StatusBadge key={reason} status="neutral">
                  {REASON_LABELS[reason] ?? reason}: {count}
                </StatusBadge>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Sem decisões registradas ainda. Os contadores aparecem quando o tráfego chega nos links protegidos.
        </p>
      )}

      {/* Item 209: challenge JS nunca coletado — se há tráfego mas nenhum
          beacon chegou, o snippet /t.js não está instalado nas páginas e as
          camadas D–H (WebGL, fuso, comportamento, entropia) ficam inertes. */}
      {agg && agg.total > 0 && data?.challenge && data.challenge.beacons === 0 && (
        <div className="mb-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
          <p className="font-medium text-warning">Desafio JavaScript sem coleta</p>
          <p className="mt-1 leading-snug text-muted-foreground text-pretty">
            Seus links recebem tráfego, mas nenhuma página devolveu o desafio JS — provavelmente o
            snippet <code className="rounded bg-secondary px-1 font-mono">/t.js</code> não está
            instalado. Sem ele, as camadas de WebGL, fuso horário, comportamento e entropia ficam
            desligadas e o julgamento usa só rede e cabeçalhos. Instale{' '}
            {/* Item 489: defer — o rastreio nunca pode bloquear o LCP da página do cliente */}
            <code className="rounded bg-secondary px-1 font-mono">{'<script src="https://SEU-DOMINIO/t.js" defer></script>'}</code>{' '}
            no <code className="rounded bg-secondary px-1 font-mono">{'<head>'}</code> das suas páginas
            de destino.
          </p>
        </div>
      )}

      {/* Itens 201/202/203: veredito sticky + anti-replay de ttclid.
          O sticky é UNIDIRECIONAL: só cacheia BOT (6h), nunca "real" — um bot
          jamais fica preso como humano (fail-safe). Limpar um vid força o
          judge a re-rodar na próxima visita daquele visitante. */}
      {(data?.sticky?.available || (data?.ttclidReplays ?? 0) > 0) && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {data?.sticky?.available && (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{data.sticky.count.toLocaleString('pt-BR')}{data.sticky.truncated ? '+' : ''}</span>{' '}
                visitante(s) em cache como bot (6h)
              </span>
            )}
            {(data?.ttclidReplays ?? 0) > 0 && (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{(data?.ttclidReplays ?? 0).toLocaleString('pt-BR')}</span>{' '}
                replay(s) de link de anúncio barrados (30d)
              </span>
            )}
            {/* Item 258: acessos barrados por velocity (device-farm suspeito) */}
            {(agg?.reasons?.velocity ?? 0) > 0 && (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{(agg?.reasons?.velocity ?? 0).toLocaleString('pt-BR')}</span>{' '}
                acesso(s) suspeito(s) de automação barrado(s)
              </span>
            )}
          </div>
          {data?.sticky?.available && (
            <form
              className="mt-2 flex items-center gap-1.5"
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
                placeholder="v_id do visitante para reteste"
                className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                aria-label="v_id do visitante para limpar o veredito de bot"
              />
              <button
                type="submit"
                className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
              >
                Limpar veredito
              </button>
            </form>
          )}
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            O cache é unidirecional: só guarda veredito de bot, nunca de humano — um robô jamais fica
            &quot;preso&quot; como real. Limpe um v_id apenas quando um visitante legítimo caiu no cache.
          </p>
          {/* Item 222: limpar o cache de infraestrutura (ASN) de um IP —
              reteste imediato quando o lookup ficou errado/negativo */}
          <form
            className="mt-2 flex items-center gap-1.5"
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
              placeholder="IP para refazer lookup de infraestrutura"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="IP para limpar o cache de ASN"
            />
            <button
              type="submit"
              className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Limpar ASN
            </button>
          </form>
          {/* Itens 256/259: liberar um IP legítimo do limite de acessos (velocity).
              As chaves de contagem expiram sozinhas no fim da janela (TTL); esta
              ação só serve para liberar ANTES — ex.: escritório no mesmo NAT. */}
          <form
            className="mt-2 flex items-center gap-1.5"
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
              placeholder="IP para liberar do limite de acessos"
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-[11px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              aria-label="IP para liberar do limite de acessos por velocity"
            />
            <button
              type="submit"
              className="h-7 shrink-0 rounded-md border border-border px-2 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary"
            >
              Liberar IP
            </button>
          </form>
          <p className="mt-1.5 text-[10px] leading-snug text-muted-foreground">
            A contagem de acessos expira sozinha ao fim da janela configurada — liberar um IP só é
            necessário quando visitantes legítimos (mesmo Wi-Fi/NAT) caíram no limite agora.
          </p>
        </div>
      )}

      {/* Por link */}
      {links.filter((l) => l.total > 0).length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-border pt-3">
          {links
            .filter((l) => l.total > 0)
            .sort((a, b) => b.total - a.total)
            .map((l) => {
              const pct = l.total ? Math.round(l.blockRate * 100) : 0
              return (
                <li key={l.tipo + l.slug} className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <StatusBadge status={l.tipo === 'cloak' ? 'info' : 'neutral'}>
                        {l.tipo === 'cloak' ? '/c' : '/go'}
                      </StatusBadge>
                      <span className="truncate text-sm text-foreground">{l.nome}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setResetting({ key: l.tipo === 'cloak' ? 'cloak:' + l.slug : l.slug, nome: l.nome })
                      }
                      className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={`Zerar ${l.nome}`}
                    >
                      <RotateCcw className="size-3.5" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="text-success">offer {l.offer}</span>
                    <span className="text-warning">white {l.white}</span>
                    <span className="ml-auto">{pct}% bloqueado</span>
                  </div>
                  <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="bg-success" style={{ width: `${100 - pct}%` }} aria-hidden="true" />
                    <div className="bg-warning" style={{ width: `${pct}%` }} aria-hidden="true" />
                  </div>
                  {/* Item 144: evolução diária offer×white */}
                  {Array.isArray(l.daily) && <DailyMiniChart daily={l.daily} />}
                </li>
              )
            })}
        </ul>
      )}

      {/* Item 184: confirmação antes de zerar contadores (ação irreversível) */}
      <ConfirmDialog
        open={Boolean(resetting)}
        title={resetting?.key ? `Zerar contadores de "${resetting.nome}"?` : 'Zerar TODOS os contadores?'}
        description={
          resetting?.key ? (
            <>As decisões offer/white registradas deste link serão apagadas. Esta ação não pode ser desfeita.</>
          ) : (
            <>Todos os contadores de cloaking (todos os links) serão apagados. Esta ação não pode ser desfeita.</>
          )
        }
        confirmLabel="Zerar"
        busy={resetBusy}
        onConfirm={confirmReset}
        onClose={() => setResetting(null)}
      />
    </GlassCard>
  )
}
