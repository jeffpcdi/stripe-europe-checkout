'use client'

import { useMemo, useState } from 'react'
import { AlertTriangle, ChevronDown, Timer, X } from 'lucide-react'
import { useStats } from '@/lib/api'
import { aggregate, periodStart, isMacroCampaign } from '@/lib/metrics'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'
import { PeriodPicker } from '@/components/overview/period-picker'
import { LeadsTable } from './leads-table'
import { fmtPercent, gwLabel, formatMoney, fmtDurationShort } from '@/lib/format'
import type { Period } from '@/lib/types'

/** Mediana simples; null com amostra < 3 (pouca base para afirmar algo). */
function median(values: number[]): number | null {
  if (values.length < 3) return null
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

// Cores de gateway dentro da paleta da identidade (sem azul fora da paleta)
const GW_COLORS = ['#25f4ee', '#fe2c55', '#22c55e', '#fbbf24', '#0ec2bd', '#f4f4f5']

export function FunnelView() {
  const { data, isLoading } = useStats()
  const [period, setPeriod] = useState<Period>('7d')

  // ── Item 301: funil filtrável por link e campanha ─────────────────────
  // '' = tudo. Filtramos os LEADS antes de agregar: visitas/checkout/compra
  // vêm deles, então o funil inteiro (barras, taxas, gargalo) reage junto.
  const [linkFilter, setLinkFilter] = useState('')
  const [campaignFilter, setCampaignFilter] = useState('')

  // Opções derivadas dos próprios leads (só o que existe de fato nos dados)
  const filterOptions = useMemo(() => {
    const links = new Set<string>()
    const campaigns = new Set<string>()
    for (const l of data?.leads ?? []) {
      if (l.linkSlug) links.add(l.linkSlug)
      // Fase 1: não oferece macro não substituída como opção de filtro
      if (l.utm?.campaign && !isMacroCampaign(l.utm.campaign)) campaigns.add(l.utm.campaign)
    }
    return {
      links: [...links].sort(),
      campaigns: [...campaigns].sort(),
    }
  }, [data])

  const hasFilter = !!(linkFilter || campaignFilter)
  const filteredData = useMemo(() => {
    if (!data || !hasFilter) return data
    return {
      ...data,
      leads: data.leads.filter(
        (l) =>
          (!linkFilter || l.linkSlug === linkFilter) &&
          (!campaignFilter || l.utm?.campaign === campaignFilter),
      ),
    }
  }, [data, hasFilter, linkFilter, campaignFilter])

  const m = useMemo(() => {
    if (!filteredData) return null
    return aggregate(filteredData, periodStart(period))
  }, [filteredData, period])

  // Itens 316/317: valores monetários e tempos medianos por etapa,
  // derivados dos leads do período (só o que os dados sustentam).
  const stageExtras = useMemo(() => {
    if (!filteredData?.leads) return null
    const from = periodStart(period)
    let checkoutValue = 0
    const v2cDeltas: number[] = []
    const c2pDeltas: number[] = []
    for (const l of filteredData.leads) {
      if (from && new Date(l.at).getTime() < from.getTime()) continue
      // 316: valor esperado dos que chegaram ao checkout e não compraram ainda
      if (l.stage === 'checkout' && l.expectedAmount) checkoutValue += l.expectedAmount
      // 317: visita → 1º checkout
      const firstHit = l.checkoutHits?.[0]?.at
      if (firstHit) {
        const d = new Date(firstHit).getTime() - new Date(l.at).getTime()
        if (d > 0) v2cDeltas.push(d)
      }
      // 317: último checkout → compra
      const lastHit = l.checkoutHits?.length
        ? l.checkoutHits[l.checkoutHits.length - 1].at
        : null
      if (l.stage === 'purchased' && l.purchasedAt && lastHit) {
        const d = new Date(l.purchasedAt).getTime() - new Date(lastHit).getTime()
        if (d > 0) c2pDeltas.push(d)
      }
    }
    return {
      checkoutValue,
      v2cMedian: median(v2cDeltas),
      c2pMedian: median(c2pDeltas),
    }
  }, [filteredData, period])

  // 316: receita real da etapa final (moeda dominante do período)
  const purchasedValue = m ? (m.rev[m.mainCur] ?? 0) : 0

  // Fase 2: compras órfãs (webhook sem lead rastreado casado) no mesmo recorte.
  // A receita já as inclui (rev vem dos eventos de venda), então sem esta fatia
  // o funil dizia "0 compraram" enquanto o rótulo mostrava receita — a
  // incoerência que o operador via. A taxa de conversão segue só sobre as
  // rastreadas (m.purchased); a nota apenas revela o que a receita já contava.
  const orphanPurchases = m?.orphanPurchases ?? 0
  const trackedPurchased = m?.purchased ?? 0
  const orphanNote =
    orphanPurchases > 0
      ? `${trackedPurchased} rastreada${trackedPurchased === 1 ? '' : 's'} · ${orphanPurchases} não rastreada${orphanPurchases === 1 ? '' : 's'}`
      : null

  // ── Item 303: benchmark interno — taxa atual vs média 30d por etapa ────
  // Mesmo recorte de link/campanha do funil (comparar filtrado com global
  // seria maçã vs banana). Sem sentido em '30d'/'all': o período é a base.
  // FIX: precisa vir ANTES do early return de loading — hook depois de
  // return condicional viola as Rules of Hooks ("Rendered more hooks...").
  const bench = useMemo(() => {
    if (!filteredData || period === '30d' || period === 'all') return null
    const b = aggregate(filteredData, periodStart('30d'))
    // amostra mínima: com menos de 20 visitas em 30d a "média" é ruído
    if (b.visits < 20) return null
    return {
      v2c: +((b.reachedCheckout / b.visits) * 100).toFixed(1),
      c2p: b.reachedCheckout ? +((b.purchased / b.reachedCheckout) * 100).toFixed(1) : 0,
    }
  }, [filteredData, period])

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-40" />
        <Skeleton className="h-64" />
      </div>
    )
  }

  const max = Math.max(m?.visits ?? 1, 1)
  const v2c = m && m.visits ? +((m.reachedCheckout / m.visits) * 100).toFixed(1) : 0
  // Item 145: taxa entre etapas (não só do topo)
  const c2p =
    m && m.reachedCheckout ? +((m.purchased / m.reachedCheckout) * 100).toFixed(1) : 0
  // Item 146: identifica o gargalo — a maior queda percentual entre etapas
  const dropV2C = m && m.visits ? 100 - v2c : 0
  const dropC2P = m && m.reachedCheckout ? 100 - c2p : 0
  const bottleneck: 1 | 2 | null =
    !m || (!m.visits && !m.reachedCheckout)
      ? null
      : dropV2C >= dropC2P
        ? 1
        : 2

  // ── Item 302: "iniciou pagamento" ≠ "aprovado" ─────────────────────────
  // Tentativas = eventos do gateway (vendas + recusas) no período. Eventos
  // não carregam link/campanha, então com filtro ativo a etapa É OCULTADA
  // — mostrar um número global num funil recortado seria mentir.
  const attempts = m ? m.sales + m.failed : 0
  const showAttempts = !hasFilter && attempts > 0
  const a2p = m && attempts ? +((m.sales / attempts) * 100).toFixed(1) : 0

  // Itens 107–109: barras na identidade (gradiente na 1ª etapa, ciano com
  // opacidade decrescente nas seguintes); rótulos nunca truncados.
  const steps = [
    {
      label: 'Visitaram',
      sub: 'topo do funil',
      value: m?.visits ?? 0,
      bar: 'var(--brand-grad)',
      color: 'var(--accent)',
      rate: fmtPercent(100),
      stepRate: null as string | null,
      isBottleneck: false,
      money: null as string | null,
      elapsed: null as string | null,
      bench: null as { delta: number; base: number } | null,
      orphanNote: null as string | null,
    },
    {
      // Item 302: sub corrigido — chegar ao checkout não é iniciar pagamento
      label: 'Checkout',
      sub: 'entraram no checkout',
      value: m?.reachedCheckout ?? 0,
      bar: 'color-mix(in oklab, var(--accent) 72%, transparent)',
      color: 'var(--accent)',
      rate: fmtPercent(v2c),
      stepRate: `${fmtPercent(v2c)} das visitas`,
      isBottleneck: bottleneck === 1,
      // Item 316: dinheiro parado no checkout (esperado, ainda não pago)
      money:
        stageExtras && stageExtras.checkoutValue > 0
          ? `${formatMoney(stageExtras.checkoutValue, m?.mainCur)} em aberto`
          : null,
      // Item 317: mediana visita → 1º checkout
      elapsed:
        stageExtras?.v2cMedian != null
          ? `~${fmtDurationShort(stageExtras.v2cMedian)} após a visita`
          : null,
      // Item 303: desvio da taxa atual vs média 30d (pontos percentuais)
      bench: bench ? { delta: +(v2c - bench.v2c).toFixed(1), base: bench.v2c } : null,
      orphanNote: null as string | null,
    },
    // Item 302: etapa intermediária — o gateway registrou uma tentativa
    // (aprovada ou recusada). Pode passar do checkout: retentativas e vendas
    // órfãs também contam, por isso o sub explica a origem do número.
    ...(showAttempts
      ? [
          {
            label: 'Tentaram pagar',
            sub: 'tentativas registradas pelo gateway',
            value: attempts,
            bar: 'color-mix(in oklab, var(--accent) 58%, transparent)',
            color: 'var(--accent)',
            rate: fmtPercent(m && m.visits ? +((attempts / m.visits) * 100).toFixed(1) : 0),
            stepRate: `${m?.failed ?? 0} recusada${(m?.failed ?? 0) === 1 ? '' : 's'}`,
            isBottleneck: false,
            money: null as string | null,
            elapsed: null as string | null,
            bench: null as { delta: number; base: number } | null,
            orphanNote: null as string | null,
          },
        ]
      : []),
    {
      label: 'Compraram',
      sub: 'pagamento aprovado',
      value: m?.purchased ?? 0,
      bar: 'color-mix(in oklab, var(--accent) 44%, transparent)',
      color: 'var(--accent)',
      rate: fmtPercent(m?.overall ?? 0),
      // Item 302: com a etapa de tentativas visível, a taxa que importa é
      // a aprovação do gateway; sem ela, mantém a taxa sobre o checkout
      stepRate: showAttempts
        ? `${fmtPercent(a2p)} de aprovação`
        : `${fmtPercent(c2p)} do checkout`,
      isBottleneck: bottleneck === 2,
      // Item 316: receita real na moeda dominante
      money: purchasedValue > 0 ? `${formatMoney(purchasedValue, m?.mainCur)} em receita` : null,
      // Item 317: mediana último checkout → compra
      elapsed:
        stageExtras?.c2pMedian != null
          ? `~${fmtDurationShort(stageExtras.c2pMedian)} após o checkout`
          : null,
      // Item 303: checkout→compra atual vs média 30d
      bench: bench ? { delta: +(c2p - bench.c2p).toFixed(1), base: bench.c2p } : null,
      // Fase 2: fatia rastreada vs órfã (só aparece quando há venda órfã)
      orphanNote,
    },
  ]

  // Item 318: sugestão de ação atrelada ao gargalo identificado
  const bottleneckHint =
    bottleneck === 1
      ? 'A maior perda é entre a visita e o checkout: revise a oferta e o carregamento da página.'
      : bottleneck === 2
        ? 'A maior perda é no pagamento: confira recusas por gateway e ofereça outro meio de pagamento.'
        : null

  return (
    <div className="flex flex-col gap-4">
      {/* Item 301: filtros de link/campanha — o funil INTEIRO reage (barras,
          taxas, gargalo, gateways e tabela), não só a listagem. */}
      <div className="flex flex-wrap items-center gap-2">
        {filterOptions.links.length > 0 ? (
          <select
            value={linkFilter}
            onChange={(e) => setLinkFilter(e.target.value)}
            aria-label="Filtrar funil por link"
            className="glass h-8 rounded-lg border border-border/50 bg-transparent px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">Todos os links</option>
            {filterOptions.links.map((s) => (
              <option key={s} value={s}>
                /{s}
              </option>
            ))}
          </select>
        ) : null}
        {filterOptions.campaigns.length > 0 ? (
          <select
            value={campaignFilter}
            onChange={(e) => setCampaignFilter(e.target.value)}
            aria-label="Filtrar funil por campanha"
            className="glass h-8 rounded-lg border border-border/50 bg-transparent px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <option value="">Todas as campanhas</option>
            {filterOptions.campaigns.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : null}
        {/* A4.5: filtro ativo vira pill removível com X */}
        {linkFilter ? (
          <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1 font-mono text-[11px] text-accent">
            /{linkFilter}
            <button
              type="button"
              onClick={() => setLinkFilter('')}
              aria-label={`Remover filtro do link ${linkFilter}`}
              className="rounded-full p-0.5 transition-colors hover:bg-accent/20"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ) : null}
        {campaignFilter ? (
          <span className="flex items-center gap-1 rounded-full border border-accent/40 bg-accent/10 py-1 pl-2.5 pr-1 font-mono text-[11px] text-accent">
            {campaignFilter}
            <button
              type="button"
              onClick={() => setCampaignFilter('')}
              aria-label={`Remover filtro da campanha ${campaignFilter}`}
              className="rounded-full p-0.5 transition-colors hover:bg-accent/20"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ) : null}
        <div className="ml-auto">
          <PeriodPicker value={period} onChange={setPeriod} />
        </div>
      </div>

      {/* V2-85: card do funil vira peça central com borda energia + hairline;
          o selo "gargalo" agora pulsa a borda para puxar o olho */}
      <GlassCard className="energy-border top-hairline p-5">
        <h2 className="section-head mb-4 text-sm font-semibold text-foreground">Funil de conversão</h2>
        <div className="flex flex-col gap-4">
          {steps.map((st, i) => {
            const w = Math.max(5, (st.value / max) * 100)
            return (
              <div key={st.label} className="flex flex-col gap-1">
                {/* A4.2: conector entre etapas com a taxa de passagem; o maior
                    ponto de queda ganha o selo "gargalo" em vermelho */}
                {i > 0 && st.stepRate ? (
                  <div className="flex items-center gap-1.5 pl-[152px] pb-1 font-mono text-[10px] tabular-nums text-faint">
                    <ChevronDown className="size-3" aria-hidden="true" />
                    <span>{st.stepRate}</span>
                    {st.isBottleneck ? (
                      /* V2-86: selo com anel pulsante — o gargalo grita */
                      <span className="badge-new rounded-full bg-[rgba(254,44,85,.12)] px-1.5 py-px font-semibold uppercase tracking-wider text-[#fe2c55]">
                        gargalo
                      </span>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid grid-cols-[140px_1fr_60px] items-center gap-3">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">{st.label}</p>
                      <p className="text-xs text-muted-foreground">{st.sub}</p>
                    </div>
                    {/* Item 146: maior queda destacada com alerta âmbar */}
                    {st.isBottleneck ? (
                      <span
                        className="flex shrink-0 items-center"
                        title="Maior queda do funil — atenção nesta etapa"
                      >
                        <AlertTriangle className="size-3.5 text-warning" aria-hidden="true" />
                        <span className="sr-only">Maior queda do funil</span>
                      </span>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div
                      className={
                        st.isBottleneck
                          ? 'h-8 flex-1 overflow-hidden rounded-md bg-muted/30 ring-1 ring-warning/40'
                          : 'h-8 flex-1 overflow-hidden rounded-md bg-muted/30'
                      }
                    >
                      {/* Item 143: preenchimento da esquerda com stagger de 300ms.
                          A4.3: partículas ciano fluem pela barra preenchida. */}
                      <div
                        key={`${period}-${st.value}`}
                        className="funnel-bar relative h-full rounded-md"
                        style={{
                          width: `${w}%`,
                          background: st.bar,
                          animationDelay: `${i * 300}ms`,
                        }}
                      >
                        {st.value > 0 ? <span className="funnel-flow" aria-hidden="true" /> : null}
                      </div>
                    </div>
                    {/* Itens 108/147: cápsula glass com CountUp mono */}
                    <span
                      className="glass shrink-0 rounded-full px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums"
                      style={{ color: st.color }}
                    >
                      <CountUp value={st.value} />
                    </span>
                  </div>
                  <span className="text-right font-mono text-sm font-semibold tabular-nums text-muted-foreground">
                    {st.rate}
                  </span>
                </div>
                {/* Itens 145/316/317: taxa, dinheiro e tempo mediano da etapa */}
                {st.stepRate || st.money || st.elapsed || st.bench || st.orphanNote ? (
                  <p className="pl-[152px] font-mono text-[10.5px] tabular-nums text-faint">
                    {[st.stepRate, st.money, st.elapsed].filter(Boolean).map((part, j) => (
                      <span key={String(part)}>
                        {j > 0 ? ' · ' : ''}
                        {st.money === part ? <span data-sensitive>{part}</span> : part}
                      </span>
                    ))}
                    {/* Fase 2: fatia rastreada vs órfã — o "não rastreada" em
                        âmbar para o operador entender de onde vem a receita
                        quando "compraram" parece zerado */}
                    {st.orphanNote ? (
                      <span
                        className="text-warning"
                        title="Vendas confirmadas por webhook que não casaram com um lead rastreado. A receita as inclui; a taxa de conversão, não."
                      >
                        {st.stepRate || st.money || st.elapsed ? ' · ' : ''}
                        {st.orphanNote}
                      </span>
                    ) : null}
                    {/* Item 303: desvio vs média 30d — verde acima, âmbar abaixo,
                        neutro quando empata (delta 0 não é nem bom nem ruim) */}
                    {st.bench ? (
                      <span
                        className={
                          st.bench.delta > 0
                            ? 'text-success'
                            : st.bench.delta < 0
                              ? 'text-warning'
                              : undefined
                        }
                        title={`Média dos últimos 30 dias: ${fmtPercent(st.bench.base)}`}
                      >
                        {' · '}
                        {st.bench.delta > 0 ? '▲' : st.bench.delta < 0 ? '▼' : '='}{' '}
                        {st.bench.delta === 0
                          ? 'na média 30d'
                          : `${Math.abs(st.bench.delta).toLocaleString('pt-BR')} pp vs média 30d`}
                      </span>
                    ) : null}
                  </p>
                ) : null}
              </div>
            )
          })}
        </div>
        {/* Item 318: o gargalo deixa de ser só um ícone e ganha ação */}
        {bottleneckHint ? (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-warning/25 bg-warning/5 px-3 py-2.5">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
            <p className="text-pretty text-xs leading-relaxed text-muted-foreground">
              {bottleneckHint}{' '}
              {bottleneck === 2 ? (
                <a href="/dashboard/activity?f=failed" className="text-warning underline-offset-2 hover:underline">
                  Ver recusas na Atividade
                </a>
              ) : null}
            </p>
          </div>
        ) : null}
      </GlassCard>

      {/* A4.5: estado vazio filtrado ganha CTA para limpar os filtros */}
      {hasFilter && (m?.visits ?? 0) === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhuma visita corresponde aos filtros ativos neste período.
          </p>
          <button
            type="button"
            onClick={() => {
              setLinkFilter('')
              setCampaignFilter('')
            }}
            className="btn-ghost !px-4"
          >
            Limpar filtros
          </button>
        </GlassCard>
      ) : null}

      {/* A4.4: tempos medianos entre etapas em cards compactos com count-up */}
      {stageExtras && (stageExtras.v2cMedian != null || stageExtras.c2pMedian != null) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {stageExtras.v2cMedian != null ? (
            <GlassCard className="flex items-center gap-3 p-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'rgba(37,244,238,.1)' }}
              >
                <Timer className="size-5" style={{ color: '#25f4ee' }} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">Visita → checkout</p>
                <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                  <CountUp
                    value={stageExtras.v2cMedian}
                    format={(v) => fmtDurationShort(v)}
                  />
                </p>
              </div>
            </GlassCard>
          ) : null}
          {stageExtras.c2pMedian != null ? (
            <GlassCard className="flex items-center gap-3 p-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: 'rgba(34,197,94,.1)' }}
              >
                <Timer className="size-5" style={{ color: '#22c55e' }} aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm text-muted-foreground">Checkout → compra</p>
                <p className="font-mono text-lg font-semibold tabular-nums text-foreground">
                  <CountUp
                    value={stageExtras.c2pMedian}
                    format={(v) => fmtDurationShort(v)}
                  />
                </p>
              </div>
            </GlassCard>
          ) : null}
        </div>
      ) : null}

      {/* Cards por gateway */}
      <div>
        <h2 className="section-head mb-3 text-sm font-semibold text-foreground">Conversão por gateway</h2>
        {m && m.byGateway.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {m.byGateway.map((g, i) => {
              const conv = g.checkout ? +((g.purchased / g.checkout) * 100).toFixed(1) : 0
              const color = GW_COLORS[i % GW_COLORS.length]
              return (
                <GlassCard key={g.name} className="p-4">
                  <div className="mb-3 flex items-center gap-2">
                    <span
                      className="rounded-md px-2 py-0.5 text-xs font-semibold text-white"
                      style={{ backgroundColor: color }}
                    >
                      {gwLabel(g.name)}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">{conv}% conversão</span>
                  </div>
                  <div className="flex gap-5">
                    <div>
                      <p className="label-mono">Checkouts</p>
                      <p className="font-mono text-lg font-semibold text-foreground">{g.checkout}</p>
                    </div>
                    <div>
                      <p className="label-mono">Compras</p>
                      <p className="font-mono text-lg font-semibold" style={{ color }}>
                        {g.purchased}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted/30">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.min(100, conv)}%`, backgroundColor: color }}
                    />
                  </div>
                </GlassCard>
              )
            })}
          </div>
        ) : (
          <GlassCard className="p-8 text-center text-sm text-muted-foreground">
            Nenhum checkout registrado neste período.
          </GlassCard>
        )}
      </div>

      {/* Tabela de leads — também respeita os filtros do item 301 */}
      <LeadsTable leads={filteredData?.leads ?? []} periodStart={periodStart(period)} />
    </div>
  )
}
