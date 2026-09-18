'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '@/lib/use-persisted-state'
import {
  Plus,
  Copy,
  Check,
  Pencil,
  Trash2,
  Search,
  Play,
  Loader2,
  ExternalLink,
  History,
  MoreHorizontal,
} from 'lucide-react'
import { useCloakConfig, useCloakEntries, useCloakStats, apiSend } from '@/lib/api'
import type { CloakEntry, CloakTestResult } from '@/lib/types'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'
import { CloakEntryEditor } from './cloak-entry-editor'
import { CloakDecisionLog } from './cloak-decision-log'

// Espelha os thresholds usados pelo motor. `custom` usa o threshold gravado no entry.
const SENS_THRESHOLD: Record<string, number> = { strict: 30, balanced: 40, loose: 55 }
const SENS_LABEL: Record<string, string> = {
  strict: 'Rígida',
  balanced: 'Equilibrada',
  loose: 'Leve',
  custom: 'Personalizada',
}

type SortKey = 'recentes' | 'nome' | 'trafego'

export function CloakEntriesPanel() {
  const { data, mutate } = useCloakEntries()
  const { data: statsData } = useCloakStats()
  const { data: globalConfig } = useCloakConfig()
  const [creating, setCreating] = useState(false)
  const [initialDomain, setInitialDomain] = useState('')
  const [editing, setEditing] = useState<CloakEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copyAnnounce, setCopyAnnounce] = useState('')
  const [testing, setTesting] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<Record<string, CloakTestResult>>({})
  const [query, setQuery] = useState('')
  const [sort, setSort] = usePersistedState<SortKey>('cloak-entries:sort', 'recentes')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const [deleting, setDeleting] = useState<CloakEntry | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
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

  const statBySlug = useMemo(() => {
    const m: Record<string, { offer: number; white: number; total: number; blockRate: number }> = {}
    for (const l of statsData?.links ?? []) {
      if (l.tipo === 'cloak') m[l.slug] = { offer: l.offer, white: l.white, total: l.total, blockRate: l.blockRate }
    }
    return m
  }, [statsData])

  function urlFor(e: CloakEntry) {
    const base = e.dominio ? `https://${e.dominio}` : baseUrl
    return `${base}/${e.slug}`
  }

  function effectiveSafeUrl(e: CloakEntry) {
    const own = String(e.whitePageUrl || '').trim()
    if (own) return own
    const globalSafe = String(globalConfig?.defaultWhitePage || '').trim()
    if (globalSafe) return globalSafe
    const base = e.dominio ? `https://${e.dominio}` : baseUrl
    return base ? `${base.replace(/\/$/, '')}/_safe` : ''
  }

  function closeActionMenu(target: EventTarget | null) {
    const node = target instanceof HTMLElement ? target : null
    const details = node?.closest('details')
    if (details instanceof HTMLDetailsElement) details.open = false
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

  async function confirmDelete() {
    if (!deleting || deleteBusy) return
    const target = deleting
    setDeleteBusy(true)
    let removed = false
    try {
      await apiSend(`/api/cloak/entries/${encodeURIComponent(target.slug)}?baseUpdatedAt=${encodeURIComponent(target.updatedAt)}`, 'DELETE')
      removed = true
      setDeleting(null)
      toast.success(`Link protegido "${target.nome}" removido.`)
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

  // Liga/desliga somente a proteção. A URL /c continua funcionando quando disabled.
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
      toast.error(`Não foi possível ${next ? 'ativar' : 'desativar'} a proteção de "${e.nome}"`, {
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
        toast.success(enabled ? 'Proteção ativada nos links selecionados' : 'Proteção desativada nos links selecionados')
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
    <section>
      <span className="sr-only" role="status" aria-live="polite">{copyAnnounce}</span>

      <header className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-foreground">Links protegidos</h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            Crie URLs com regras próprias de proteção, segmentação e destino.
          </p>
          {entries.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span><strong className="font-semibold tabular-nums text-foreground">{summary.active}</strong> com proteção ativa</span>
              <span><strong className="font-semibold tabular-nums text-foreground">{summary.total}</strong> decisões</span>
              {summary.total > 0 && (
                <span><strong className="font-semibold tabular-nums text-warning">{summary.blockRate.toFixed(0)}%</strong> no destino seguro</span>
              )}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-10 self-start items-center justify-center gap-2 rounded-lg bg-[color:var(--brand-cyan)] px-4 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30"
        >
          <Plus className="size-4" /> Novo link protegido
        </button>
      </header>

      {showControls && (
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nome, slug, destino ou domínio"
              className="h-10 w-full rounded-lg border border-border bg-secondary/35 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none focus:ring-2 focus:ring-brand-cyan/10"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-10 rounded-lg border border-border bg-secondary/35 px-3 text-sm text-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none focus:ring-2 focus:ring-brand-cyan/10"
            aria-label="Ordenar links protegidos"
          >
            <option value="recentes">Mais recentes</option>
            <option value="nome">Nome (A–Z)</option>
            <option value="trafego">Mais tráfego</option>
          </select>
        </div>
      )}

      {selected.size > 0 && (
        <div className="mb-4 flex flex-col gap-2 border-y border-border/60 py-3 text-sm sm:flex-row sm:items-center">
          <span className="font-medium text-foreground">{selected.size} selecionado(s)</span>
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkSet(true)}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Ativar proteção
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => bulkSet(false)}
              className="rounded-md px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
            >
              Desativar proteção
            </button>
            <button
              type="button"
              disabled={bulkBusy}
              onClick={() => setConfirmingBulkDelete(true)}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
            >
              <Trash2 className="size-3.5" /> Excluir
            </button>
            <button
              type="button"
              onClick={() => {
                setSelected(new Set())
                setConfirmingBulkDelete(false)
              }}
              className="rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Limpar
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="py-12 text-center sm:text-left">
          <p className="text-sm font-medium text-foreground">Nenhum link protegido</p>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Crie um link para definir destino principal, proteção e segmentação próprias.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Nenhum link corresponde à busca.</p>
      ) : (
        <ul className="divide-y divide-border/60 border-y border-border/60">
          {visible.map((e) => {
            const st = statBySlug[e.slug]
            const sens = e.sensitivity ?? 'balanced'
            const tr = testResult[e.slug]
            const effectiveShadow = e.shadowMode === true || globalConfig?.shadowMode === true
            const safeUrl = effectiveSafeUrl(e)
            const segmentMeta = [
              e.mobileOnly ? 'Somente mobile' : null,
              e.paises.length > 0 ? `${e.paises.length} ${e.paises.length === 1 ? 'país' : 'países'}` : null,
              e.idiomas.length > 0 ? `${e.idiomas.length} ${e.idiomas.length === 1 ? 'idioma' : 'idiomas'}` : null,
            ].filter(Boolean) as string[]

            return (
              <li key={e.slug} className="py-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5">
                      {showControls && (
                        <input
                          type="checkbox"
                          checked={selected.has(e.slug)}
                          onChange={() => toggleSelect(e.slug)}
                          className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                          aria-label={`Selecionar ${e.nome}`}
                        />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{e.nome}</p>
                        <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{urlFor(e)}</p>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={`size-1.5 rounded-full ${e.enabled ? 'bg-success' : 'bg-muted-foreground'}`} aria-hidden="true" />
                      <span>{e.enabled ? 'Proteção ativa' : 'Proteção desativada'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                    <span>{SENS_LABEL[sens] ?? SENS_LABEL.balanced} · limite {thresholdFor(e)}</span>
                    {e.enabled && effectiveShadow && <><span aria-hidden="true">·</span><span>Somente observação</span></>}
                    {segmentMeta.map((item) => <span key={item}>· {item}</span>)}
                  </div>

                  <p className="min-w-0 truncate text-sm text-muted-foreground">
                    <span className="font-medium text-success">Principal</span>
                    <span className="mx-1.5 text-border">·</span>
                    <span>{e.offerUrl}</span>
                  </p>

                  {st && st.total > 0 && (
                    <div>
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                        <span className="tabular-nums"><span className="text-success">{st.offer}</span> principal</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums"><span className="text-warning">{st.white}</span> seguro</span>
                        <span aria-hidden="true">·</span>
                        <span className="tabular-nums">{Math.round(st.blockRate * 100)}% no seguro</span>
                      </div>
                      <div className="mt-2 flex h-0.5 overflow-hidden rounded-full bg-muted">
                        <div className="bg-success" style={{ width: `${100 - Math.round(st.blockRate * 100)}%` }} aria-hidden="true" />
                        <div className="bg-warning" style={{ width: `${Math.round(st.blockRate * 100)}%` }} aria-hidden="true" />
                      </div>
                    </div>
                  )}

                  {tr && (
                    <div className="border-t border-border/50 pt-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-1.5 rounded-full ${
                              tr.verdict === 'real' ? 'bg-success' : tr.verdict === 'erro' ? 'bg-destructive' : 'bg-warning'
                            }`}
                            aria-hidden="true"
                          />
                          <span className="font-medium text-foreground">
                            {tr.verdict === 'real' ? 'Destino principal' : tr.verdict === 'bot' ? 'Destino seguro' : 'Falha no teste'}
                          </span>
                        </div>
                        <span className="text-xs tabular-nums text-muted-foreground">Score de risco {tr.score} · limite {tr.threshold}</span>
                      </div>
                      {tr.gates && (
                        <div className="mt-2 grid gap-1 text-xs text-muted-foreground sm:grid-cols-3">
                          {(
                            [
                              ['Dispositivo', tr.gates.mobile],
                              ['País', tr.gates.pais],
                              ['Idioma', tr.gates.idioma],
                            ] as const
                          ).map(([label, state]) => (
                            <span key={label}>
                              {label} · {state === 'off' ? 'sem restrição' : state === 'pass' ? 'passa' : 'bloqueia'}
                            </span>
                          ))}
                        </div>
                      )}
                      {tr.signals.length > 0 && (
                        <details className="group mt-2">
                          <summary className="cursor-pointer list-none text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
                            Detalhes do teste
                          </summary>
                          <p className="mt-2 break-words font-mono text-xs leading-relaxed text-muted-foreground">{tr.signals.join(' · ')}</p>
                        </details>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-3">
                    <span className="mr-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={e.enabled}
                        onChange={() => toggleEnabled(e)}
                        label={`${e.enabled ? 'Desativar' : 'Ativar'} proteção de ${e.nome}`}
                        size="sm"
                      />
                      {e.enabled ? 'Proteção ativa' : 'Proteção desativada'}
                    </span>
                    <button type="button" onClick={() => handleTest(e)} disabled={testing === e.slug} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50">
                      {testing === e.slug ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} Testar
                    </button>
                    <button type="button" onClick={() => handleCopy(e)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      {copied === e.slug ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />} {copied === e.slug ? 'Copiado' : 'Copiar URL'}
                    </button>
                    <button type="button" onClick={() => setEditing(e)} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground">
                      <Pencil className="size-3.5" /> Editar
                    </button>
                    <details className="relative ml-auto">
                      <summary className="cursor-pointer list-none rounded-md p-2 text-muted-foreground outline-none transition-colors hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-cyan/20" aria-label={`Mais ações para ${e.nome}`}>
                        <MoreHorizontal className="size-4" />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-48 rounded-lg border border-border bg-card p-1.5 shadow-lg">
                        <button
                          type="button"
                          onClick={(event) => {
                            setLogOpen((cur) => (cur === 'cloak:' + e.slug ? null : 'cloak:' + e.slug))
                            closeActionMenu(event.currentTarget)
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                        >
                          <History className="size-3.5" />
                          {logOpen === 'cloak:' + e.slug ? 'Fechar histórico' : 'Histórico'}
                        </button>
                        {safeUrl && (
                          <a
                            href={safeUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(event) => closeActionMenu(event.currentTarget)}
                            className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
                          >
                            <ExternalLink className="size-3.5" /> Ver destino seguro
                          </a>
                        )}
                        <div className="my-1 border-t border-border/50" />
                        <button
                          type="button"
                          onClick={(event) => {
                            setDeleting(e)
                            closeActionMenu(event.currentTarget)
                          }}
                          className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="size-3.5" /> Remover
                        </button>
                      </div>
                    </details>
                  </div>

                  {logOpen === 'cloak:' + e.slug && (
                    <CloakDecisionLog entryKey={'cloak:' + e.slug} onClose={() => setLogOpen(null)} />
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      <ConfirmDialog
        open={confirmingBulkDelete && selected.size > 0}
        appearance="quiet"
        tone="danger"
        title={`Remover ${selected.size} ${selected.size === 1 ? 'link protegido' : 'links protegidos'}?`}
        description={<>As URLs selecionadas deixam de funcionar. Esta ação não pode ser desfeita.</>}
        confirmLabel={selected.size === 1 ? 'Remover link' : 'Remover links'}
        busy={bulkBusy}
        onConfirm={bulkDelete}
        onClose={() => setConfirmingBulkDelete(false)}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        appearance="quiet"
        tone="danger"
        title={deleting ? `Remover "${deleting.nome}"?` : ''}
        description={
          deleting && (statBySlug[deleting.slug]?.total ?? 0) > 0 ? (
            <>
              Este link já tem <strong className="text-foreground">{statBySlug[deleting.slug].total} decisões registradas</strong>.
              Ao remover, a URL /{deleting.slug} para de funcionar e os contadores desse link se perdem.
            </>
          ) : (
            <>A URL /{deleting?.slug} deixa de funcionar imediatamente. Esta ação não pode ser desfeita.</>
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
    </section>
  )
}
