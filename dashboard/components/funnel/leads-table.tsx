'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { LeadDrawer } from './lead-drawer'
import { GlassCard } from '@/components/glass-card'
// Item 323: STAGE_LABEL/STAGE_CLASS agora vêm centralizados de lib/format
import {
  countryFlag,
  gwLabel,
  timeAgo,
  formatMoney,
  plural,
  STAGE_LABEL,
  STAGE_CLASS,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Download,
  Search,
  X,
  Flame,
  Smartphone,
  Tablet,
  Monitor,
} from 'lucide-react'
import type { Lead } from '@/lib/types'
import { usePersistedState } from '@/lib/use-persisted-state'

const PAGE_SIZE = 20

/* Item 309: e-mail mascarado por padrão; o completo só no hover/focus —
   a tabela fica aberta em tela cheia em escritórios, PII não deve vazar. */
function maskEmailCell(e?: string | null) {
  if (!e || !e.includes('@')) return ''
  const [user, domain] = e.split('@')
  return (user.length <= 2 ? user[0] + '…' : user.slice(0, 2) + '…') + '@' + domain
}

/* Item 308: colunas ordenáveis. `null` = ordem natural (mais recente 1º). */
type SortKey = 'stage' | 'amount' | 'at' | 'country'

const STAGE_ORDER: Record<string, number> = { visit: 0, checkout: 1, purchased: 2 }

/* Item 308: cabeçalho ordenável — botão real (acessível por teclado) com
   aria-sort e seta indicando a direção ativa. */
function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  onSort,
  last,
}: {
  label: string
  k: SortKey
  sortKey: SortKey | null
  sortDir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
  last?: boolean
}) {
  const active = sortKey === k
  return (
    <th
      className={cn('label-mono pb-2', !last && 'pr-3')}
      aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
    >
      <button
        type="button"
        onClick={() => onSort(k)}
        className={cn(
          'flex items-center gap-0.5 transition-colors hover:text-foreground',
          active && 'text-primary',
        )}
        title={active ? 'Clique para inverter/limpar a ordenação' : `Ordenar por ${label.toLowerCase()}`}
      >
        {label}
        {active ? (
          sortDir === 'asc' ? (
            <ChevronUp className="size-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="size-3" aria-hidden="true" />
          )
        ) : null}
      </button>
    </th>
  )
}

/** Item 149: destaca o termo buscado em ciano dentro do texto. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const idx = text.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, idx)}
      <mark className="search-hit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  )
}

export function LeadsTable({
  leads,
  periodStart,
}: {
  leads: Lead[]
  periodStart: Date | null
}) {
  // Item 180: o input responde na hora, mas o filtro só roda 300ms depois
  const [rawQuery, setRawQuery] = useState('')
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  // Atalho Cmd+K / Ctrl+K para focar na busca
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])
  const [stage, setStage] = useState('')
  const [gateway, setGateway] = useState('')
  // Item 306: filtro por país, derivado dos leads presentes
  const [country, setCountry] = useState('')
  // Itens 305/309: colunas opcionais (persistem — preferência de layout)
  const [showCampaign, setShowCampaign] = usePersistedState<boolean>('leads:col-campaign', false)
  const [showEmail, setShowEmail] = usePersistedState<boolean>('leads:col-email', false)
  const [page, setPage] = useState(0)
  // Item 304: drawer de perfil — clique na linha abre o painel lateral
  const [openLeadId, setOpenLeadId] = useState<string | null>(null)

  // Item 329: realce dos leads que chegaram DEPOIS do load (mesmo padrão
  // seenIds do feed de Atividade) — o snapshot inicial nunca pisca.
  const seenIds = useRef<Set<string> | null>(null)
  useEffect(() => {
    if (leads.length > 0 && seenIds.current === null) {
      seenIds.current = new Set(leads.map((l) => l.id))
    }
  }, [leads])
  // Item 312: vendas órfãs (sem lead rastreado) eram filtradas em silêncio —
  // dinheiro invisível. O toggle traz de volta com explicação.
  const [showOrphans, setShowOrphans] = useState(false)
  // Item 308: ordenação por coluna. null = ordem natural (mais recente 1º).
  // Ciclo por clique: desc → asc → natural (3º clique limpa).
  const [sortKey, setSortKey] = useState<SortKey | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey !== key) {
      setSortKey(key)
      setSortDir('desc')
    } else if (sortDir === 'desc') {
      setSortDir('asc')
    } else {
      setSortKey(null)
    }
    resetPage()
  }

  const searching = rawQuery !== query
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(rawQuery), 300)
    return () => window.clearTimeout(t)
  }, [rawQuery])

  const gateways = useMemo(() => {
    const seen = new Set<string>()
    for (const l of leads) if (l.gateway) seen.add(l.gateway)
    return [...seen].sort()
  }, [leads])

  // Item 306: países presentes nos leads, ordenados pelo nome legível
  const countries = useMemo(() => {
    const seen = new Map<string, string>()
    for (const l of leads) if (l.country) seen.set(l.country, l.countryName || l.country)
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [leads])

  const filtered = useMemo(() => {
    const q = query.toLowerCase()
    return leads.filter((l) => {
      if (l.orphan && !showOrphans) return false
      if (periodStart && new Date(l.at).getTime() < periodStart.getTime()) return false
      if (stage && l.stage !== stage) return false
      if (gateway && l.gateway !== gateway) return false
      if (country && l.country !== country) return false
      if (q) {
        // Item 311: telefone entra na busca (só dígitos, para "11 9..." achar)
        const hay = [l.id, l.country, l.countryName, l.customer, l.email, l.utm?.source, l.utm?.campaign]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        const phoneDigits = String(l.phone ?? '').replace(/\D/g, '')
        const qDigits = q.replace(/\D/g, '')
        if (!hay.includes(q) && !(qDigits.length >= 4 && phoneDigits.includes(qDigits))) return false
      }
      return true
    })
  }, [leads, query, stage, gateway, country, periodStart, showOrphans])

  // Item 312: quantas vendas órfãs existem no período (para o rótulo do toggle)
  const orphanCount = useMemo(() => {
    return leads.filter((l) => {
      if (!l.orphan) return false
      if (periodStart && new Date(l.at).getTime() < periodStart.getTime()) return false
      return true
    }).length
  }, [leads, periodStart])

  // Item 308: ordenação aplicada sobre o filtrado. "Valor" usa o reportado
  // (dinheiro real) e cai para o esperado; leads sem valor vão para o fim.
  const sorted = useMemo(() => {
    if (!sortKey) return filtered
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (l: Lead): number | string => {
      switch (sortKey) {
        case 'stage':
          return STAGE_ORDER[l.stage] ?? -1
        case 'amount':
          return l.reportedAmount ?? l.expectedAmount ?? (sortDir === 'asc' ? Infinity : -Infinity)
        case 'at':
          return new Date(l.at).getTime()
        case 'country':
          return (l.countryName || l.country || '\uffff').toLowerCase()
      }
    }
    return [...filtered].sort((a, b) => {
      const va = val(a)
      const vb = val(b)
      if (va === vb) return 0
      return (va < vb ? -1 : 1) * dir
    })
  }, [filtered, sortKey, sortDir])

  // Item 150: paginação com clamp quando o filtro muda
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)
  const from = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1
  const to = Math.min(filtered.length, (safePage + 1) * PAGE_SIZE)

  // Item 148: chips removíveis dos filtros ativos
  const chips: { label: string; clear: () => void }[] = []
  if (stage) chips.push({ label: `Etapa: ${STAGE_LABEL[stage] ?? stage}`, clear: () => setStage('') })
  if (gateway) chips.push({ label: `Gateway: ${gwLabel(gateway)}`, clear: () => setGateway('') })
  if (country)
    chips.push({
      label: `País: ${countries.find(([c]) => c === country)?.[1] ?? country}`,
      clear: () => setCountry(''),
    })
  if (query)
    chips.push({
      label: `Busca: "${query}"`,
      clear: () => {
        setRawQuery('')
        setQuery('')
      },
    })

  function resetPage() {
    setPage(0)
  }

  // Item 130: exporta os leads filtrados como CSV, client-side.
  // Item 310: colunas UTM + e-mail/telefone MASCARADOS (o CSV circula por
  // planilhas e e-mails — PII completa não deve sair do painel).
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
    const maskEmail = (e?: string | null) => {
      if (!e || !e.includes('@')) return ''
      const [user, domain] = e.split('@')
      return (user.length <= 2 ? user[0] + '…' : user.slice(0, 2) + '…') + '@' + domain
    }
    const maskPhone = (p?: string | null) => {
      const digits = String(p ?? '').replace(/\D/g, '')
      return digits.length < 4 ? '' : '…' + digits.slice(-4)
    }
    const header = [
      'id', 'etapa', 'pais', 'gateway', 'valor', 'quando',
      'utm_source', 'utm_medium', 'utm_campaign', 'email_mascarado', 'telefone_mascarado', 'orfa',
    ]
    const rows = filtered.map((l) =>
      [
        l.id,
        STAGE_LABEL[l.stage] ?? l.stage,
        l.countryName || l.country || '',
        l.gateway ? gwLabel(l.gateway) : '',
        l.amount ? formatMoney(l.amount, l.currency) : '',
        l.at,
        l.utm?.source || '',
        l.utm?.medium || '',
        l.utm?.campaign || '',
        maskEmail(l.email),
        maskPhone(l.phone),
        l.orphan ? 'sim' : '',
      ].map(esc).join(','),
    )
    const blob = new Blob(['\uFEFF' + [header.join(','), ...rows].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `leads-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <GlassCard className="p-4">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h2 className="section-head text-sm font-semibold text-foreground">Leads</h2>
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {plural(filtered.length, 'lead')}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Item 312: toggle de vendas órfãs — só aparece quando existem */}
          {orphanCount > 0 ? (
            <button
              type="button"
              onClick={() => {
                setShowOrphans((v) => !v)
                resetPage()
              }}
              aria-pressed={showOrphans}
              className={cn(
                'flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors',
                showOrphans
                  ? 'border-warning/50 bg-warning/10 text-warning'
                  : 'border-border/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
              )}
              title="Vendas confirmadas pelo gateway sem lead rastreado (compra sem passar pelo link, ou de outro dispositivo)"
            >
              {plural(orphanCount, 'venda órfã', 'vendas órfãs')}
            </button>
          ) : null}
          {/* Item 130: exportar CSV discreto no canto do card */}
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="flex h-8 items-center gap-1.5 rounded-md border border-border/60 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
            title="Exportar leads filtrados como CSV"
          >
            <Download className="size-3.5" aria-hidden="true" />
            CSV
          </button>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <input
              ref={searchRef}
              type="search"
              value={rawQuery}
              onChange={(e) => {
                setRawQuery(e.target.value)
                resetPage()
              }}
              placeholder="Buscar lead… (Cmd+K)"
              className="h-8 w-52 rounded-md border border-border/60 bg-muted/20 pl-8 pr-7 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
            {/* Item 180: micro-spinner enquanto o debounce roda */}
            {searching && (
              <span
                className="micro-spinner absolute right-2.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
            )}
          </div>
          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value)
              resetPage()
            }}
            aria-label="Filtrar por etapa"
            className="h-8 rounded-md border border-border/60 bg-muted/20 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Todas etapas</option>
            <option value="visit">Visita</option>
            <option value="checkout">Checkout</option>
            <option value="purchased">Comprou</option>
          </select>
          <select
            value={gateway}
            onChange={(e) => {
              setGateway(e.target.value)
              resetPage()
            }}
            aria-label="Filtrar por gateway"
            className="h-8 rounded-md border border-border/60 bg-muted/20 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          >
            <option value="">Todos gateways</option>
            {gateways.map((g) => (
              <option key={g} value={g}>
                {gwLabel(g)}
              </option>
            ))}
          </select>
          {/* Item 306: filtro por país (só quando há 2+ países) */}
          {countries.length > 1 ? (
            <select
              value={country}
              onChange={(e) => {
                setCountry(e.target.value)
                resetPage()
              }}
              aria-label="Filtrar por país"
              className="h-8 rounded-md border border-border/60 bg-muted/20 px-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
            >
              <option value="">Todos países</option>
              {countries.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </select>
          ) : null}
          {/* Itens 305/309: colunas opcionais (persistem entre sessões) */}
          <div className="flex items-center gap-1" role="group" aria-label="Colunas opcionais">
            <button
              type="button"
              aria-pressed={showCampaign}
              onClick={() => setShowCampaign(!showCampaign)}
              className={cn(
                'h-8 rounded-md border px-2 text-[11px] transition-colors',
                showCampaign
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
              title="Mostrar/ocultar coluna de campanha (UTM)"
            >
              Campanha
            </button>
            <button
              type="button"
              aria-pressed={showEmail}
              onClick={() => setShowEmail(!showEmail)}
              className={cn(
                'h-8 rounded-md border px-2 text-[11px] transition-colors',
                showEmail
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/60 text-muted-foreground hover:text-foreground',
              )}
              title="Mostrar/ocultar coluna de e-mail (mascarado)"
            >
              E-mail
            </button>
          </div>
        </div>
      </div>

      {/* Item 148: chips dos filtros ativos, removíveis com X */}
      {chips.length > 0 ? (
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => {
                c.clear()
                resetPage()
              }}
              className="anim-pop-in flex items-center gap-1 rounded-full border border-[rgba(37,244,238,0.3)] bg-[rgba(37,244,238,0.08)] px-2.5 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-[rgba(37,244,238,0.15)]"
            >
              {c.label}
              <X className="size-3" aria-hidden="true" />
              <span className="sr-only">Remover filtro</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="mb-2" />
      )}

      {filtered.length > 0 ? (
        <>
          {/* V2-84: zebra sutil nas linhas pares — leitura de tabela longa */}
          <div className="overflow-x-auto">
            <table className="table-zebra w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-b border-border/60">
                  <th className="label-mono pb-2 pr-3">ID</th>
                  <SortableTh label="Etapa" k="stage" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <th className="label-mono pb-2 pr-3">Gateway</th>
                  <SortableTh label="País" k="country" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  {/* Item 328: dispositivo (ua.js já parseia na entrada) */}
                  <th className="label-mono pb-2 pr-3">
                    <span className="sr-only">Dispositivo</span>
                    <Smartphone className="size-3.5 text-muted-foreground" aria-hidden="true" />
                  </th>
                  <th className="label-mono pb-2 pr-3">Origem</th>
                  {/* Item 305: coluna de campanha opcional */}
                  {showCampaign ? <th className="label-mono pb-2 pr-3">Campanha</th> : null}
                  {/* Item 309: coluna de e-mail mascarado opcional */}
                  {showEmail ? <th className="label-mono pb-2 pr-3">E-mail</th> : null}
                  <SortableTh label="Valor" k="amount" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortableTh label="Quando" k="at" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} last />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((l) => {
                  const origin = l.utm?.source || (l.referer ? 'ref' : 'direto')
                  const hits = l.checkoutHits?.length ? `${l.checkoutHits.length}x` : null
                  // Item 329: lead que não estava no snapshot inicial pisca
                  const isNew = seenIds.current !== null && !seenIds.current.has(l.id)
                  return (
                    <tr
                      key={l.id}
                      onClick={() => setOpenLeadId(l.id)}
                      onKeyDown={(ev) => {
                        if (ev.key === 'Enter' || ev.key === ' ') {
                          ev.preventDefault()
                          setOpenLeadId(l.id)
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={`Abrir perfil do lead ${l.id.slice(0, 12)}`}
                      className={cn(
                        'tr-hover cursor-pointer border-b border-border/30 last:border-b-0',
                        isNew && 'anim-cell-flash',
                      )}
                    >
                      <td className="py-2.5 pr-3 font-mono text-xs text-muted-foreground">
                        <Highlight text={l.id.slice(0, 12)} query={query} />
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={cn(
                            'rounded-md px-2 py-0.5 text-xs font-semibold',
                            STAGE_CLASS[l.stage] || 'bg-muted/40 text-muted-foreground'
                          )}
                        >
                          {STAGE_LABEL[l.stage] || l.stage}
                        </span>
                        {/* Item 313: 3+ idas ao checkout sem comprar = lead
                            quente que está travando em algo (preço, cartão) */}
                        {l.stage !== 'purchased' && (l.checkoutHits?.length || 0) > 2 ? (
                          <span
                            className="ml-1.5 inline-flex items-center gap-0.5 rounded-md bg-[rgba(249,115,22,.12)] px-1.5 py-0.5 text-[10px] font-semibold text-[#f97316]"
                            title={`Voltou ao checkout ${l.checkoutHits!.length} vezes sem concluir — vale um contato`}
                          >
                            <Flame className="size-2.5" aria-hidden="true" /> quente
                          </span>
                        ) : null}
                        {/* Item 312: marca visual da venda sem rastreamento */}
                        {l.orphan ? (
                          <span
                            className="ml-1.5 rounded-md bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold text-warning"
                            title="Venda confirmada pelo gateway sem lead rastreado"
                          >
                            órfã
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {l.gateway ? (
                          <span className="text-foreground">
                            {gwLabel(l.gateway)}
                            {hits ? <span className="ml-1 text-muted-foreground">{hits}</span> : null}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs">
                        {l.country ? (
                          <span className="text-foreground">
                            <span aria-hidden>{countryFlag(l.country)}</span>{' '}
                            <Highlight text={l.countryName || l.country} query={query} />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      {/* Item 328: dispositivo — ícone com os detalhes no title */}
                      <td className="py-2.5 pr-3">
                        {l.device ? (
                          <span
                            className="text-muted-foreground"
                            title={[l.device, l.os, l.browser].filter(Boolean).join(' · ')}
                          >
                            {l.device === 'mobile' ? (
                              <Smartphone className="size-3.5" aria-hidden="true" />
                            ) : l.device === 'tablet' ? (
                              <Tablet className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Monitor className="size-3.5" aria-hidden="true" />
                            )}
                            <span className="sr-only">{l.device}</span>
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                        <Highlight text={origin} query={query} />
                      </td>
                      {/* Item 305: campanha (UTM) opcional */}
                      {showCampaign ? (
                        <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                          {l.utm?.campaign ? (
                            <Highlight text={l.utm.campaign} query={query} />
                          ) : (
                            '—'
                          )}
                        </td>
                      ) : null}
                      {/* Item 309: e-mail mascarado; completo no hover/focus */}
                      {showEmail ? (
                        <td className="py-2.5 pr-3 text-xs">
                          {l.email ? (
                            <span
                              data-sensitive
                              tabIndex={0}
                              className="group/em cursor-default text-muted-foreground"
                              title={l.email}
                            >
                              <span className="group-hover/em:hidden group-focus/em:hidden">
                                {maskEmailCell(l.email)}
                              </span>
                              <span className="hidden text-foreground group-hover/em:inline group-focus/em:inline">
                                {l.email}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      ) : null}
                      <td className="py-2.5 pr-3 text-xs tabular-nums">
                        {l.reportedAmount ? (
                          <span className="font-semibold text-success">
                            {formatMoney(l.reportedAmount, l.reportedCurrency)}
                          </span>
                        ) : l.expectedAmount ? (
                          <span className="text-muted-foreground">
                            {formatMoney(l.expectedAmount, l.expectedCurrency)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="py-2.5 text-xs tabular-nums text-muted-foreground">{timeAgo(l.at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Item 150: paginação glass com contagem mono */}
          {pageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-3">
              <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                {from}–{to} de {filtered.length}
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  disabled={safePage === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  aria-label="Página anterior"
                  style={safePage === 0 ? { opacity: 0.4, pointerEvents: 'none' } : undefined}
                >
                  <ChevronLeft className="size-3.5" aria-hidden="true" />
                </button>
                {/* Item 320: pular direto para uma página (útil com 50+ páginas) */}
                <label className="flex items-center gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
                  <span className="sr-only">Ir para página</span>
                  <input
                    type="number"
                    min={1}
                    max={pageCount}
                    value={safePage + 1}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (Number.isFinite(n)) setPage(Math.min(pageCount - 1, Math.max(0, n - 1)))
                    }}
                    className="h-6 w-12 rounded border border-border/60 bg-transparent text-center text-[11px] tabular-nums text-foreground focus:border-primary/40 focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    aria-label={`Página atual, de 1 a ${pageCount}`}
                  />
                  /{pageCount}
                </label>
                <button
                  type="button"
                  className="btn-ghost !px-2"
                  disabled={safePage >= pageCount - 1}
                  onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
                  aria-label="Próxima página"
                  style={
                    safePage >= pageCount - 1 ? { opacity: 0.4, pointerEvents: 'none' } : undefined
                  }
                >
                  <ChevronRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}
        </>
      ) : leads.length === 0 ? (
        /* Item 322: conta sem NENHUM lead — problema de instalação, não de filtro */
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Nenhum lead rastreado ainda</p>
          <p className="max-w-sm text-pretty text-xs text-muted-foreground">
            Os leads aparecem aqui quando alguém abre um link rastreado com o pixel instalado.
            Confira a instalação em Links e Pixels.
          </p>
        </div>
      ) : (
        /* Item 322: há leads, mas o recorte atual não retorna nada */
        <div className="flex flex-col items-center gap-3 py-10">
          <p className="text-sm text-muted-foreground">
            Nenhum lead corresponde ao período/filtros ativos.
          </p>
          {chips.length > 0 || stage || gateway || query ? (
            <button
              type="button"
              onClick={() => {
                setStage('')
                setGateway('')
                setRawQuery('')
                setQuery('')
                resetPage()
              }}
              className="btn-ghost !px-4"
            >
              Limpar filtros
            </button>
          ) : null}
        </div>
      )}
      {/* Item 304: perfil completo do lead com jornada (dados do item 326) */}
      <LeadDrawer leadId={openLeadId} onClose={() => setOpenLeadId(null)} />
    </GlassCard>
  )
}
