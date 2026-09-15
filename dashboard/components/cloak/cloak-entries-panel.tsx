'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '@/lib/use-persisted-state'
import { cn } from '@/lib/utils'
import {
  Plus,
  Link2,
  Copy,
  Check,
  Pencil,
  Trash2,
  Smartphone,
  Search,
  Play,
  Loader2,
  ExternalLink,
  ShieldAlert,
  ShieldCheck,
  Scale,
  ShieldOff,
  History,
  MoreHorizontal,
  Activity,
} from 'lucide-react'
import { useCloakEntries, useCloakStats, apiSend } from '@/lib/api'
import type { CloakEntry, CloakSensitivity, CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'
import { CloakEntryEditor } from './cloak-entry-editor'
import { CloakDecisionLog } from './cloak-decision-log'
import { SectionTitle } from '@/components/section-title'

// Item 136: threshold efetivo por sensibilidade (espelha bot-filter.js) para o
// badge do card — 'custom' usa o threshold gravado no próprio entry.
const SENS_THRESHOLD: Record<string, number> = { strict: 30, balanced: 40, loose: 55 }
const SENS_META: Record<string, { label: string; icon: typeof ShieldAlert }> = {
  strict: { label: 'Rígido', icon: ShieldAlert },
  balanced: { label: 'Equilibrado', icon: Scale },
  loose: { label: 'Frouxo', icon: ShieldOff },
  custom: { label: 'Custom', icon: Scale },
}

type SortKey = 'recentes' | 'nome' | 'trafego'

export function CloakEntriesPanel() {
  const { data, mutate } = useCloakEntries()
  const { data: statsData } = useCloakStats()
  const [creating, setCreating] = useState(false)
  const [initialDomain, setInitialDomain] = useState('')
  const [editing, setEditing] = useState<CloakEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  // Item 143: anúncio acessível da cópia (padrão dos itens 55/93/110)
  const [copyAnnounce, setCopyAnnounce] = useState('')
  // Item 134: teste por entry (resultado inline por slug)
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, CloakTestResult>>({})
  // Item 136: busca + ordenação (só aparecem com 2+ links)
  // Item 185: a ordenação persiste entre navegações; a busca é por sessão
  const [query, setQuery] = useState('')
  const [sort, setSort] = usePersistedState<SortKey>('cloak-entries:sort', 'recentes')
  // Item 137: seleção para ações em massa
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  // Itens 146/184: confirmação destrutiva padronizada — entry com tráfego
  // exige digitar o nome antes de excluir (contadores se perdem junto)
  const [deleting, setDeleting] = useState<CloakEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Item 170: qual link está com o histórico de decisões expandido (um por vez,
  // pra manter só um SWR de decisões ativo)
  const [logOpen, setLogOpen] = useState<string | null>(null)

  const entries = data?.entries ?? []
  const baseUrl = data?.baseUrl ?? ''

  // Atalho vindo da aba Domínios: abre a criação já com o domínio selecionado.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('novo') !== '1') return
    const domain = String(params.get('dominio') || '').trim().toLowerCase()
    if (!domain) return
    setInitialDomain(domain)
    setCreating(true)
    params.delete('novo')
    params.delete('dominio')
    const qs = params.toString()
    window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
  }, [])

  // Item 135: mapa slug → estatística offer/white do link /c
  const statBySlug = useMemo(() => {
    const m: Record<string, { offer: number; white: number; total: number; blockRate: number }> = {}
    for (const l of statsData?.links ?? []) {
      if (l.tipo === 'cloak') m[l.slug] = { offer: l.offer, white: l.white, total: l.total, blockRate: l.blockRate }
    }
    return m
  }, [statsData])

  function urlFor(e: CloakEntry) {
    const base = e.dominio ? `https://${e.dominio}` : baseUrl
    return `${base}/c/${e.slug}`
  }

  function thresholdFor(e: CloakEntry) {
    const s = e.sensitivity ?? 'balanced'
    if (s === 'custom') return e.threshold ?? 40
    return SENS_THRESHOLD[s] ?? 40
  }

  function handleCopy(e: CloakEntry) {
    navigator.clipboard.writeText(urlFor(e)).then(() => {
      setCopied(e.slug)
      setCopyAnnounce(`URL do link ${e.nome} copiada para a área de transferência.`)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  // Itens 146/184: exclusão via ConfirmDialog; com tráfego, exige o nome digitado
  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    const target = deleting
    setDeleteBusy(true)
    let removed = false
    try {
      await apiSend(`/api/cloak/entries/${encodeURIComponent(target.slug)}?baseUpdatedAt=${encodeURIComponent(target.updatedAt)}`, 'DELETE')
      removed = true
      setDeleting(null)
      toast.success(`Link de cloaking "${target.nome}" removido.`)
    } catch (err) {
      toast.error('Falha ao remover o link.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeleteBusy(false)
    }
    if (removed) {
      try {
        await mutate()
      } catch (error) {
        toast.info('Link removido, mas a lista não atualizou completamente', {
          hint: error instanceof Error ? error.message : undefined,
        })
      }
    }
  }

  // Item 134: simula o julgamento DESTE /c/:slug com o request atual do admin
  async function handleTest(e: CloakEntry) {
    if (testing) return
    setTesting(e.slug)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST', { slug: e.slug })
      setTestResult((prev) => ({ ...prev, [e.slug]: r }))
    } catch (err) {
      toast.error(`Falha ao testar "${e.nome}"`, {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setTesting(null)
    }
  }

  // Item 137: liga/desliga inline (otimista com rollback), reusa o POST de entries
  async function toggleEnabled(e: CloakEntry) {
    const next = !e.enabled
    const previous = data
    await mutate(
      data ? { ...data, entries: entries.map((x) => (x.slug === e.slug ? { ...x, enabled: next } : x)) } : data,
      { revalidate: false },
    )
    try {
      await apiSend('/api/cloak/entries', 'POST', { slug: e.slug, enabled: next, _baseUpdatedAt: e.updatedAt })
      await mutate()
    } catch (err) {
      if (previous) await mutate(previous, { revalidate: false })
      toast.error(`Não foi possível ${next ? 'ativar' : 'pausar'} "${e.nome}"`, {
        hint: err instanceof Error ? err.message : undefined,
      })
    }
  }

  function toggleSelect(slug: string) {
    setSelected((prev) => {
      const n = new Set(prev)
      if (n.has(slug)) n.delete(slug)
      else n.add(slug)
      return n
    })
  }

  async function bulkSet(enabled: boolean) {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const pending = [...selected]
    const failed = new Set<string>()
    try {
      for (const slug of pending) {
        const current = entries.find((entry) => entry.slug === slug)
        try {
          await apiSend('/api/cloak/entries', 'POST', { slug, enabled, _baseUpdatedAt: current?.updatedAt })
        } catch {
          failed.add(slug)
        }
      }
      setSelected(failed)
      await mutate()
      if (failed.size) {
        toast.error('Alguns links não foram atualizados', {
          hint: `${pending.length - failed.size} concluído(s) · ${failed.size} falhou(aram). Os que falharam continuam selecionados.`,
        })
      } else {
        toast.success(enabled ? 'Links ativados' : 'Links pausados')
      }
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const pending = [...selected]
    const failed = new Set<string>()
    try {
      for (const slug of pending) {
        const current = entries.find((entry) => entry.slug === slug)
        try {
          const revision = current?.updatedAt ? `?baseUpdatedAt=${encodeURIComponent(current.updatedAt)}` : ''
          await apiSend(`/api/cloak/entries/${encodeURIComponent(slug)}${revision}`, 'DELETE')
        } catch {
          failed.add(slug)
        }
      }
      setSelected(failed)
      setConfirmingBulkDelete(false)
      await mutate()
      if (failed.size) {
        toast.error('Alguns links não puderam ser removidos', {
          hint: `${pending.length - failed.size} removido(s) · ${failed.size} falhou(aram). Os que falharam continuam selecionados.`,
        })
      } else {
        toast.success('Links removidos')
      }
    } finally {
      setBulkBusy(false)
    }
  }

  // Item 136: filtro + ordenação
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries
    if (q) {
      list = list.filter(
        (e) =>
          e.nome.toLowerCase().includes(q) ||
          e.slug.toLowerCase().includes(q) ||
          e.offerUrl.toLowerCase().includes(q) ||
          (e.dominio ?? '').toLowerCase().includes(q),
      )
    }
    const sorted = [...list]
    if (sort === 'nome') sorted.sort((a, b) => a.nome.localeCompare(b.nome))
    else if (sort === 'trafego') sorted.sort((a, b) => (statBySlug[b.slug]?.total ?? 0) - (statBySlug[a.slug]?.total ?? 0))
    else sorted.sort((a, b) => (b.criadoEm > a.criadoEm ? 1 : -1))
    return sorted
  }, [entries, query, sort, statBySlug])

  const showControls = entries.length >= 2

  const summary = useMemo(() => {
    let total = 0
    let white = 0
    for (const link of statsData?.links ?? []) {
      if (link.tipo !== 'cloak') continue
      total += link.total || 0
      white += link.white || 0
    }
    return {
      active: entries.filter((entry) => entry.enabled).length,
      total,
      blocked: white,
      blockRate: total > 0 ? (white / total) * 100 : 0,
    }
  }, [entries, statsData])

  return (
    <GlassCard className="p-5">
      {/* Item 143: anúncio acessível de cópia para leitores de tela */}
      <span className="sr-only" role="status" aria-live="polite">{copyAnnounce}</span>
      <div className="mb-4 flex flex-col gap-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <SectionTitle>Links protegidos</SectionTitle>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">URLs com proteção e regras próprias.</p>
          </div>
          <button type="button" onClick={() => setCreating(true)} className="btn-primary self-start text-xs">
            <Plus className="size-3.5" /> Novo link protegido
          </button>
        </div>
        {entries.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span><strong className="font-semibold text-foreground">{summary.active}</strong> ativos</span>
            <span><strong className="font-semibold text-foreground">{summary.total}</strong> decisões</span>
            {summary.total > 0 && <span><strong className="font-semibold text-warning">{summary.blockRate.toFixed(0)}%</strong> protegidos</span>}
          </div>
        )}
      </div>

      {/* Item 136: busca + ordenação */}
      {showControls && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, slug, destino ou domínio"
              className="w-full rounded-lg border border-border bg-secondary/60 py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded-lg border border-border bg-secondary/60 px-2 py-1.5 text-xs text-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none"
            aria-label="Ordenar"
          >
            <option value="recentes">Mais recentes</option>
            <option value="nome">Nome (A–Z)</option>
            <option value="trafego">Mais tráfego</option>
          </select>
        </div>
      )}

      {/* Item 137: barra de ações em massa */}
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-[color:var(--brand-cyan)]/40 bg-[var(--accent-light)] px-3 py-2 text-xs">
          <span className="font-medium text-foreground">{selected.size} selecionado(s)</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkSet(true)}
              className="rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Ativar
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkSet(false)}
              className="rounded-md border border-border px-2 py-1 font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Pausar
            </button>
            {confirmingBulkDelete ? (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={bulkDelete}
                className="flex items-center gap-1 rounded-md border border-destructive/50 px-2 py-1 font-medium text-destructive transition-colors hover:bg-destructive/15 disabled:opacity-50"
              >
                {bulkBusy ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                Confirmar exclusão de {selected.size}
              </button>
            ) : (
              <button
                type="button"
                disabled={bulkBusy}
                onClick={() => setConfirmingBulkDelete(true)}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 font-medium text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-50"
              >
                <Trash2 className="size-3" /> Excluir
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setSelected(new Set())
                setConfirmingBulkDelete(false)
              }}
              className="rounded-md px-2 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Limpar
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        /* Estado vazio curto: explica só o necessário para começar. */
        <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
          <div className="flex size-16 items-center justify-center rounded-full bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] drop-shadow-[0_0_15px_rgba(37,244,238,0.3)]">
            <ShieldCheck className="size-8" />
          </div>
          <div className="max-w-md">
            <p className="text-sm font-medium text-foreground">Nenhum link protegido</p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              Defina um destino principal e, opcionalmente, um destino seguro para tráfego automatizado ou suspeito.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" /> Criar meu primeiro link
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nenhum link corresponde à busca.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((e, index) => {
            const st = statBySlug[e.slug]
            const sens = e.sensitivity ?? 'balanced'
            const SensIcon = (SENS_META[sens] ?? SENS_META.balanced).icon
            const tr = testResult[e.slug]
            return (
              <li key={e.slug} style={{ animationDelay: `${Math.min(index * 75, 1500)}ms` }} className={cn(
                "hover-float animate-in-up rounded-xl border p-4 transition-all duration-300 border-l-[3px] border-l-transparent hover:border-l-[color:var(--brand-cyan)]",
                e.enabled 
                  ? "border-primary/40 bg-[rgba(37,244,238,0.02)] shadow-[0_0_15px_rgba(37,244,238,0.1)]" 
                  : "border-border/40 bg-secondary/20 opacity-70"
              )}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    {showControls && (
                      <input
                        type="checkbox"
                        checked={selected.has(e.slug)}
                        onChange={() => toggleSelect(e.slug)}
                        className="size-3.5 shrink-0 accent-[color:var(--brand-cyan)]"
                        aria-label={`Selecionar ${e.nome}`}
                      />
                    )}
                    <span
                      className={`size-2 shrink-0 rounded-full ${e.enabled ? 'bg-success' : 'bg-muted-foreground'}`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-foreground">{e.nome}</p>
                      <p className="truncate font-mono text-[11px] text-muted-foreground">{urlFor(e)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Item 136: badge de sensibilidade + threshold efetivo */}
                    <StatusBadge status="neutral">
                      <SensIcon className="size-3" /> {(SENS_META[sens] ?? SENS_META.balanced).label} · ≥{thresholdFor(e)}
                    </StatusBadge>
                    {e.shadowMode && <StatusBadge status="info">observando</StatusBadge>}
                    {e.mobileOnly && (
                      <StatusBadge status="info">
                        <Smartphone className="size-3" /> mobile
                      </StatusBadge>
                    )}
                  </div>
                </div>

                <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Link2 className="size-3 shrink-0" />
                  <span className="truncate text-success">→ {e.offerUrl}</span>
                </div>

                {/* Item 135: estatística offer/white inline do link */}
                {st && st.total > 0 && (
                  <div className="mt-2">
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="text-success">principal {st.offer}</span>
                      <span className="text-warning">seguro {st.white}</span>
                      <span className="ml-auto">{Math.round(st.blockRate * 100)}% bloqueado</span>
                    </div>
                    <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="bg-success"
                        style={{ width: `${100 - Math.round(st.blockRate * 100)}%` }}
                        aria-hidden="true"
                      />
                      <div
                        className="bg-warning"
                        style={{ width: `${Math.round(st.blockRate * 100)}%` }}
                        aria-hidden="true"
                      />
                    </div>
                  </div>
                )}

                {/* Item 134: resultado do teste deste entry */}
                {tr && (
                  <div className="mt-2 rounded-lg border border-border bg-background/40 p-2.5 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Simulação da dashboard:</span>
                      <StatusBadge
                        status={tr.verdict === 'real' ? 'success' : tr.verdict === 'erro' ? 'error' : 'warning'}
                      >
                        {tr.verdict} · score {tr.score}/{tr.threshold}
                      </StatusBadge>
                    </div>
                    {tr.gates && (
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(
                          [
                            ['mobile', tr.gates.mobile],
                            ['país', tr.gates.pais],
                            ['idioma', tr.gates.idioma],
                          ] as const
                        ).map(([label, state]) => (
                          <span
                            key={label}
                            className={`rounded px-1.5 py-0.5 ${
                              state === 'block'
                                ? 'bg-warning/15 text-warning'
                                : state === 'pass'
                                  ? 'bg-success/15 text-success'
                                  : 'bg-secondary text-muted-foreground'
                            }`}
                          >
                            {label}: {state === 'off' ? 'desligado' : state === 'pass' ? 'passa' : 'bloqueia'}
                          </span>
                        ))}
                      </div>
                    )}
                    {tr.signals.length > 0 && (
                      <p className="mt-1 font-mono text-[10px] text-muted-foreground">{tr.signals.join(' · ')}</p>
                    )}
                  </div>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
                  <span className="flex items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/15 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Switch checked={e.enabled} onChange={() => toggleEnabled(e)} label={`${e.enabled ? 'Pausar' : 'Ativar'} ${e.nome}`} size="sm" />
                    {e.enabled ? 'Ativo' : 'Pausado'}
                  </span>
                  <button type="button" onClick={() => handleTest(e)} disabled={testing === e.slug} className="btn-secondary px-3 py-1.5 text-xs">
                    {testing === e.slug ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Testar
                  </button>
                  <button type="button" onClick={() => handleCopy(e)} className="btn-ghost px-3 py-1.5 text-xs">
                    {copied === e.slug ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {copied === e.slug ? 'Copiado' : 'Copiar URL'}
                  </button>
                  <button type="button" onClick={() => setEditing(e)} className="btn-ghost px-3 py-1.5 text-xs"><Pencil className="size-3.5" /> Editar</button>
                  <details className="relative ml-auto">
                    <summary className="list-none cursor-pointer rounded-xl border border-border/60 bg-secondary/15 p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Mais ações para ${e.nome}`}><MoreHorizontal className="size-4" /></summary>
                    <div className="absolute right-0 z-20 mt-2 w-48 rounded-2xl border border-border/80 bg-card/95 p-1.5 shadow-2xl backdrop-blur-xl">
                      <button type="button" onClick={() => setLogOpen((cur) => (cur === 'cloak:' + e.slug ? null : 'cloak:' + e.slug))} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"><History className="size-3.5" /> Histórico</button>
                      {e.whitePageUrl && <a href={e.whitePageUrl} target="_blank" rel="noopener noreferrer" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"><ExternalLink className="size-3.5" /> Ver página segura</a>}
                      <div className="my-1 border-t border-border/50" />
                      <button type="button" onClick={() => setDeleting(e)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"><Trash2 className="size-3.5" /> Remover</button>
                    </div>
                  </details>
                </div>

                {/* Itens 170/171: histórico de decisões expandível deste link */}
                {logOpen === 'cloak:' + e.slug && <CloakDecisionLog entryKey={'cloak:' + e.slug} />}
              </li>
            )
          })}
        </ul>
      )}

      {/* Itens 146/184: confirmação destrutiva; tráfego → digitar o nome */}
      <ConfirmDialog
        open={Boolean(deleting)}
        title={deleting ? `Remover "${deleting.nome}"?` : ''}
        description={
          deleting && (statBySlug[deleting.slug]?.total ?? 0) > 0 ? (
            <>
              Este link já tem <strong className="text-foreground">{statBySlug[deleting.slug].total} decisões registradas</strong>{' '}
              (principal/seguro). Ao remover, a URL /c/{deleting.slug} para de funcionar e os contadores se perdem.
            </>
          ) : (
            <>A URL /c/{deleting?.slug} deixa de funcionar imediatamente. Esta ação não pode ser desfeita.</>
          )
        }
        confirmLabel="Remover"
        confirmText={deleting && (statBySlug[deleting.slug]?.total ?? 0) > 0 ? deleting.nome : undefined}
        busy={deleteBusy}
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />

      {(creating || editing) && (
        <CloakEntryEditor
          entry={editing}
          initialDomain={editing ? '' : initialDomain}
          onClose={() => {
            setCreating(false)
            setEditing(null)
            setInitialDomain('')
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            setInitialDomain('')
            mutate()
          }}
        />
      )}
    </GlassCard>
  )
}
