'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '@/lib/use-persisted-state'
import { ErrorState } from '@/components/error-state'
import {
  Link2,
  Plus,
  Copy,
  Check,
  Pencil,
  Trash2,
  QrCode,
  TriangleAlert,
  Search,
  CopyPlus,
  ExternalLink,
  Power,
  Download,
  Archive,
  ArchiveRestore,
  MoreHorizontal,
} from 'lucide-react'
import QRCodeLib from 'qrcode'
import { useLinks, useDomains, usePixels, apiSend } from '@/lib/api'
import type { CheckoutLink } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { Skeleton } from '@/components/skeleton'
import { SectionTitle } from '@/components/section-title'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { CountUp } from '@/components/count-up'
import { LinkEditor } from './link-editor'

// Item 64: opções de ordenação da lista de links
type SortKey = 'recentes' | 'nome' | 'cliques' | 'conversoes'
const SORT_LABELS: Record<SortKey, string> = {
  recentes: 'Mais recentes',
  nome: 'Nome (A–Z)',
  cliques: 'Mais cliques',
  conversoes: 'Mais conversões',
}

// LINK_STEPS removed

export function LinksView() {
  const { data, isLoading, error, mutate } = useLinks()
  const { data: domainsData } = useDomains()
  const { data: pixelsData } = usePixels()
  const [editing, setEditing] = useState<CheckoutLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // Itens 76/184: exclusão via ConfirmDialog padronizado — com tráfego, exige
  // digitar o nome do link para confirmar
  const [deleting, setDeleting] = useState<string | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Item 64: busca + ordenação client-side (item 185: ordenação persiste
  // entre navegações; a busca é intencional por sessão, não persiste)
  const [query, setQuery] = useState('')
  const [sortBy, setSortBy] = usePersistedState<SortKey>('links:sort', 'recentes')
  // Itens 62/63: feedback de ação em andamento por card
  const [busySlug, setBusySlug] = useState<string | null>(null)
  // Item 72: ações em massa — seleção por checkbox + barra de ações
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  // Item 531: alternar entre lista padrão e arquivados
  const [showArchived, setShowArchived] = useState(false)
  // Item 71: QR code em popover glass por link — gerado LOCALMENTE (a URL do
  // link nunca sai para um serviço de terceiros)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  // Item 124: atalho "usar em um link" da aba Domínios — ?novo=1&dominio=host
  // abre o editor de criação já com o domínio selecionado
  const [presetDominio, setPresetDominio] = useState<string | null>(null)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    if (sp.get('novo') === '1') {
      setPresetDominio(sp.get('dominio'))
      setCreating(true)
      // limpa a URL para o refresh não reabrir o editor
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const appHost = domainsData?.appHost || (typeof window !== 'undefined' ? window.location.host : '')
  const links = data?.links ?? []
  const checkoutDomains = (domainsData?.domains ?? []).filter((domain) => (domain.uso ?? 'ambos') !== 'cloaker')
  const verifiedHosts = new Set((domainsData?.domains ?? []).filter((d) => d.verificado).map((d) => d.host))
  // Item 68: mapa slug → pixel para checar existência/estado do pixel do link
  const pixelBySlug = new Map((pixelsData?.pixels ?? []).map((p) => [p.slug, p]))

  // Item 64: filtro por nome/slug/domínio + ordenação
  const visibleLinks = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Item 531: arquivados ficam fora da lista padrão (histórico preservado)
    const pool = showArchived ? links.filter((l) => l.arquivado) : links.filter((l) => !l.arquivado)
    const filtered = q
      ? pool.filter(
          (l) =>
            l.nome.toLowerCase().includes(q) ||
            l.slug.toLowerCase().includes(q) ||
            (l.dominio ?? '').toLowerCase().includes(q),
        )
      : pool
    const clicksOf = (l: CheckoutLink) => l.variantes.reduce((s, v) => s + v.clicks, 0)
    const convsOf = (l: CheckoutLink) => l.variantes.reduce((s, v) => s + v.conversions, 0)
    return [...filtered].sort((a, b) => {
      if (sortBy === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR')
      if (sortBy === 'cliques') return clicksOf(b) - clicksOf(a)
      if (sortBy === 'conversoes') return convsOf(b) - convsOf(a)
      return (b.criadoEm || '').localeCompare(a.criadoEm || '') // recentes
    })
  }, [links, query, sortBy, showArchived])

  // Mantém a seleção em massa coerente quando outra ação/aba remove links ou
  // quando o SWR revalida com uma lista mais nova.
  useEffect(() => {
    setSelected((current) => {
      const available = new Set(links.map((link) => link.slug))
      const next = new Set([...current].filter((slug) => available.has(slug)))
      if (next.size === current.size && [...next].every((slug) => current.has(slug))) return current
      return next
    })
  }, [links])

  // Item 62: toggle ativo/pausado inline com atualização otimista.
  // O save() do Express faz merge parcial — basta enviar { slug, ativo }.
  async function toggleAtivo(l: CheckoutLink) {
    if (busySlug) return
    setBusySlug(l.slug)
    const previous = data
    const nextState = !l.ativo
    const optimistic = { links: links.map((x) => (x.slug === l.slug ? { ...x, ativo: nextState } : x)) }
    await mutate(optimistic, { revalidate: false })
    try {
      await apiSend('/api/links', 'POST', { slug: l.slug, ativo: nextState })
      await mutate()
      toast.success(nextState ? 'Link ativado' : 'Link pausado')
    } catch (e) {
      if (previous) await mutate(previous, { revalidate: false })
      toast.error('Não foi possível alterar o link', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusySlug(null)
    }
  }

  // Item 531: contagem de arquivados (para o botão só aparecer quando existem)
  const archivedCount = useMemo(() => links.filter((l) => l.arquivado).length, [links])

  const linkSummary = useMemo(() => {
    const current = links.filter((link) => !link.arquivado)
    const verified = new Set((domainsData?.domains ?? []).filter((domain) => domain.verificado).map((domain) => domain.host))
    const pixelsMap = new Map((pixelsData?.pixels ?? []).map((pixel) => [pixel.slug, pixel]))
    let clicks = 0
    let conversions = 0
    let attention = 0
    let active = 0
    for (const link of current) {
      if (link.ativo) active += 1
      for (const variant of link.variantes) {
        clicks += variant.clicks || 0
        conversions += variant.conversions || 0
      }
      const boundPixel = link.pixelSlug ? pixelsMap.get(link.pixelSlug) : undefined
      if ((link.dominio && !verified.has(link.dominio)) || (link.pixelSlug && (!boundPixel || !boundPixel.active))) attention += 1
    }
    return {
      total: current.length,
      active,
      clicks,
      conversions,
      conversionRate: clicks > 0 ? (conversions / clicks) * 100 : 0,
      attention,
    }
  }, [links, domainsData, pixelsData])

  // Item 531: arquivar/desarquivar — merge-patch { slug, arquivado } no save()
  async function toggleArquivado(l: CheckoutLink) {
    if (busySlug) return
    setBusySlug(l.slug)
    try {
      await apiSend('/api/links', 'POST', { slug: l.slug, arquivado: !l.arquivado })
      await mutate()
      toast.success(l.arquivado ? 'Link restaurado' : 'Link arquivado')
    } catch (e) {
      toast.error(l.arquivado ? 'Não foi possível restaurar o link' : 'Não foi possível arquivar o link', {
        hint: e instanceof Error ? e.message : undefined,
      })
    } finally {
      setBusySlug(null)
    }
  }

  // Item 63: duplicar link — cópia com slug novo e contadores zerados
  // (o normalize() do backend zera clicks/conversions ausentes no payload).
  async function duplicateLink(l: CheckoutLink) {
    setBusySlug(l.slug)
    try {
      const taken = new Set(links.map((x) => x.slug))
      let newSlug = `${l.slug}-copia`
      for (let n = 2; taken.has(newSlug); n++) newSlug = `${l.slug}-copia-${n}`
      await apiSend('/api/links', 'POST', {
        slug: newSlug,
        nome: `${l.nome} (cópia)`,
        dominio: l.dominio ?? null,
        urlWhitePage: l.urlWhitePage ?? null,
        paises: l.paises,
        idiomas: l.idiomas,
        pixelSlug: l.pixelSlug,
        ativo: false, // cópia nasce pausada para o dono revisar antes de rodar
        variantes: l.variantes.map((v) => ({
          id: v.id,
          nome: v.nome,
          url: v.url,
          urlMobile: v.urlMobile ?? null,
          urlWhitePage: v.urlWhitePage ?? null,
          peso: v.peso,
        })),
        experiment: l.experiment ? {
          enabled: l.experiment.enabled,
          autoStop: l.experiment.autoStop,
          minVisitors: l.experiment.minVisitors,
          minConversions: l.experiment.minConversions,
          confidence: l.experiment.confidence,
          minLiftPct: l.experiment.minLiftPct,
          // A cópia herda a configuração, não o vencedor/histórico da original.
          status: 'running',
          winnerId: null,
          concludedAt: null,
          lastEvaluation: null,
        } : undefined,
      })
      await mutate()
      toast.success('Cópia criada e pausada para revisão')
    } catch (e) {
      toast.error('Não foi possível duplicar o link', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusySlug(null)
    }
  }

  // Item 72: ações em massa. Reusa o merge-patch { slug, ativo } do item 62
  // e o DELETE por slug; roda em série para não estourar o rate-limit da API.
  function toggleSelect(slug: string) {
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(slug)) next.delete(slug)
      else next.add(slug)
      return next
    })
    setConfirmBulkDelete(false)
  }

  function clearSelection() {
    setSelected(new Set())
    setConfirmBulkDelete(false)
  }

  async function bulkSetAtivo(ativo: boolean) {
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const slugs = [...selected]
    let completed = 0
    try {
      for (const slug of slugs) {
        await apiSend('/api/links', 'POST', { slug, ativo })
        completed += 1
      }
      await mutate()
      clearSelection()
      toast.success(`${completed} link${completed === 1 ? '' : 's'} ${ativo ? 'ativado' : 'pausado'}${completed === 1 ? '' : 's'}`)
    } catch (e) {
      await mutate().catch(() => undefined)
      setSelected(new Set(slugs.slice(completed)))
      toast.error('A ação em massa foi interrompida', {
        hint: `${completed} de ${slugs.length} concluído(s). ${e instanceof Error ? e.message : 'Tente novamente nos itens restantes.'}`,
      })
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkDelete() {
    // Primeiro clique arma a confirmação; o segundo executa.
    if (!confirmBulkDelete) {
      setConfirmBulkDelete(true)
      return
    }
    if (bulkBusy || selected.size === 0) return
    setBulkBusy(true)
    const slugs = [...selected]
    let completed = 0
    try {
      for (const slug of slugs) {
        await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
        completed += 1
      }
      await mutate()
      clearSelection()
      toast.success(`${completed} link${completed === 1 ? '' : 's'} excluído${completed === 1 ? '' : 's'}`)
    } catch (e) {
      await mutate().catch(() => undefined)
      setSelected(new Set(slugs.slice(completed)))
      setConfirmBulkDelete(false)
      toast.error('A exclusão em massa foi interrompida', {
        hint: `${completed} de ${slugs.length} concluído(s). ${e instanceof Error ? e.message : 'Tente novamente nos itens restantes.'}`,
      })
    } finally {
      setBulkBusy(false)
    }
  }

  // Gera o QR no navegador quando o popover abre
  useEffect(() => {
    if (!qrFor) {
      setQrDataUrl(null)
      return
    }
    const link = links.find((l) => l.slug === qrFor)
    if (!link) return
    const url = `https://${link.dominio || appHost}/go/${link.slug}`
    let alive = true
    QRCodeLib.toDataURL(url, {
      width: 140,
      margin: 1,
      color: { dark: '#25f4ee', light: '#0d0d10' },
    })
      .then((d) => {
        if (alive) setQrDataUrl(d)
      })
      .catch(() => {
        if (alive) setQrDataUrl(null)
      })
    return () => {
      alive = false
    }
  }, [qrFor, appHost, links])

  function publicUrl(l: CheckoutLink) {
    const host = l.dominio || appHost
    return `https://${host}/go/${l.slug}`
  }

  async function copyUrl(l: CheckoutLink) {
    try {
      await navigator.clipboard.writeText(publicUrl(l))
      setCopied(l.slug)
      toast.success('Link copiado')
      setTimeout(() => setCopied(null), 1500)
    } catch (error) {
      toast.error('Não foi possível copiar o link', { hint: error instanceof Error ? error.message : 'Copie a URL manualmente.' })
    }
  }

  // Item 70: baixa o QR gerado no cliente como PNG (sem serviço externo).
  // Regenera em alta resolução para impressão/material de anúncio.
  async function downloadQr(l: CheckoutLink) {
    try {
      const dataUrl = await QRCodeLib.toDataURL(publicUrl(l), {
        width: 512,
        margin: 2,
        color: { dark: '#0d0d10', light: '#ffffff' },
      })
      const a = document.createElement('a')
      a.href = dataUrl
      a.download = `qr-${l.slug}.png`
      a.click()
    } catch (error) {
      toast.error('Não foi possível gerar o QR Code', { hint: error instanceof Error ? error.message : undefined })
    }
  }

  async function handleDelete(slug: string) {
    if (deleteBusy) return
    const link = links.find((l) => l.slug === slug)
    setDeleteBusy(true)
    let removed = false
    try {
      await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
      removed = true
      setDeleting(null)
      toast.success(`Link "${link?.nome ?? slug}" excluído.`)
    } catch (err) {
      toast.error('Falha ao excluir o link.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeleteBusy(false)
    }
    if (removed) {
      try {
        await mutate()
      } catch (error) {
        toast.info('Link excluído, mas a lista não atualizou completamente', {
          hint: error instanceof Error ? error.message : undefined,
        })
      }
    }
  }

  // Item 182: erro de carregamento com retry consistente (só quando não há
  // nenhum dado em cache — se já temos dados, o SWR revalida em silêncio)
  if (error && !data) {
    return <ErrorState title="Não foi possível carregar seus links de checkout." onRetry={() => mutate()} />
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }

  return (
    /* Item 58: gap-5 na raiz — mesmo ritmo vertical nas 5 abas da Gestão */
    <div className="flex flex-col gap-5">
      {error && <button type="button" className="btn-ghost self-start text-xs text-warning" onClick={() => void mutate()}>Links não atualizados · tentar novamente</button>}
      <div className="flex flex-col gap-4">
        <div className="flex justify-end">
          <button type="button" data-tour="links-new" onClick={() => setCreating(true)} className="btn-primary">
            <Plus className="size-4" />
            Novo link
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-y border-border/60 py-4 lg:grid-cols-4">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Links ativos</p>
            <p className="mt-1 text-[21px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums"><CountUp value={linkSummary.active} /><span className="text-sm font-medium text-muted-foreground">/{linkSummary.total}</span></p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Cliques</p>
            <p className="mt-1 text-[21px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums"><CountUp value={linkSummary.clicks} /></p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Conversão</p>
            <p className="mt-1 text-[21px] font-semibold leading-none tracking-[-0.02em] text-foreground tabular-nums">{linkSummary.conversionRate.toFixed(1).replace('.', ',')}%</p>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Atenção</p>
            <p className={`mt-1 text-[21px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${linkSummary.attention ? 'text-warning' : 'text-foreground'}`}>{linkSummary.attention}</p>
          </div>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          {links.length > 1 ? (
            <label className="relative min-w-0 flex-1 lg:max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar links..."
                aria-label="Buscar link por nome, slug ou domínio"
                className="h-10 w-full rounded-lg border border-border/80 bg-input/40 pl-10 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand-cyan/50 focus:outline-none focus:ring-2 focus:ring-brand-cyan/10"
              />
            </label>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            {links.length > 1 ? (
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="Ordenar links"
                className="h-10 rounded-lg border border-border/80 bg-input/40 px-3 text-sm text-foreground focus:border-brand-cyan/50 focus:outline-none focus:ring-2 focus:ring-brand-cyan/10"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => <option key={k} value={k}>{SORT_LABELS[k]}</option>)}
              </select>
            ) : null}

            {archivedCount > 0 ? (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                aria-pressed={showArchived}
                className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30 ${showArchived ? 'border-brand-cyan/35 bg-brand-cyan/10 text-brand-cyan' : 'border-border/80 bg-transparent text-muted-foreground hover:bg-secondary/40 hover:text-foreground'}`}
              >
                <Archive className="size-4" aria-hidden="true" />
                {showArchived ? 'Voltar aos ativos' : `Arquivados (${archivedCount})`}
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex min-h-5 items-center gap-2 text-xs text-muted-foreground">
          <span>{showArchived ? `${archivedCount} arquivado${archivedCount === 1 ? '' : 's'}` : `${visibleLinks.length} link${visibleLinks.length === 1 ? '' : 's'} na lista`}</span>
          {query.trim() ? <span className="text-foreground/80">· filtro ativo</span> : null}
        </div>
      </div>

      {links.length === 0 ? (
        <section className="flex min-h-[220px] flex-col items-center justify-center gap-3 py-10 text-center" aria-labelledby="links-empty-title">
          <Link2 className="size-5 text-brand-cyan/70" aria-hidden="true" />
          <div className="max-w-md space-y-1.5">
            <h3 id="links-empty-title" className="text-base font-semibold text-foreground">
              Nenhum link criado
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Crie seu primeiro link para começar a rastrear cliques e conversões.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-1 inline-flex h-10 items-center gap-1.5 rounded-lg bg-brand-cyan px-3.5 text-sm font-semibold text-slate-950 transition-colors hover:bg-brand-cyan/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/35"
          >
            <Plus className="size-4" aria-hidden="true" />
            Novo link
          </button>
        </section>
      ) : (
        <div className="flex flex-col gap-3" data-tour="links-list">
          {/* Item 72: barra de ações em massa (aparece quando há seleção) */}
          {selected.size > 0 && (
            <div
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-border/50 py-2.5"
              role="toolbar"
              aria-label="Ações em massa nos links selecionados"
            >
              <span className="text-sm font-medium text-foreground tabular-nums">
                {selected.size} selecionado{selected.size === 1 ? '' : 's'}
              </span>
              <div className="flex flex-wrap items-center gap-1 sm:gap-2">
                <button
                  type="button"
                  onClick={() => bulkSetAtivo(true)}
                  disabled={bulkBusy}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Ativar
                </button>
                <button
                  type="button"
                  onClick={() => bulkSetAtivo(false)}
                  disabled={bulkBusy}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium text-foreground transition-colors hover:bg-secondary/45 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Pausar
                </button>
                <button
                  type="button"
                  onClick={bulkDelete}
                  disabled={bulkBusy}
                  className={`inline-flex h-8 min-w-[72px] items-center justify-center rounded-md px-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    confirmBulkDelete
                      ? 'bg-destructive/12 text-destructive ring-1 ring-inset ring-destructive/30 hover:bg-destructive/16'
                      : 'text-destructive hover:bg-destructive/8'
                  }`}
                >
                  {confirmBulkDelete ? 'Confirmar exclusão' : 'Excluir'}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={bulkBusy}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Limpar
                </button>
              </div>
            </div>
          )}
          {visibleLinks.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum link corresponde a &quot;{query}&quot;.
              </p>
            </div>
          )}
          {visibleLinks.map((l, index) => {
            const clicks = l.variantes.reduce((s, v) => s + v.clicks, 0)
            const convs = l.variantes.reduce((s, v) => s + v.conversions, 0)
            // Item 65: receita somada das variantes (por moeda) + taxa de conversão
            const revenueByCur: Record<string, number> = {}
            l.variantes.forEach((v) => {
              Object.entries(v.revenue || {}).forEach(([cur, cents]) => {
                revenueByCur[cur] = (revenueByCur[cur] || 0) + (cents || 0)
              })
            })
            const revenueEntries = Object.entries(revenueByCur).filter(([, c]) => c > 0)
            const convRate = clicks > 0 ? (convs / clicks) * 100 : null
            // Item 68: estado do pixel associado ao link
            const pixel = l.pixelSlug ? pixelBySlug.get(l.pixelSlug) : undefined
            const pixelMissing = !!l.pixelSlug && !pixel
            const pixelPaused = !!pixel && !pixel.active
            const busy = busySlug === l.slug
            return (
              <div
                key={l.slug}
                className="group relative border-b border-border/45 py-4 sm:py-5 last:border-b-0"
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    {links.length > 1 && (
                      <input
                        type="checkbox"
                        checked={selected.has(l.slug)}
                        onChange={() => toggleSelect(l.slug)}
                        aria-label={`Selecionar o link ${l.nome}`}
                        className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                      />
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <h3 className="truncate text-sm font-semibold text-foreground" title={l.nome}>{l.nome}</h3>
                        <span className={`inline-flex items-center gap-1.5 text-[12px] font-medium ${
                          l.arquivado
                            ? 'text-muted-foreground'
                            : l.ativo
                              ? 'text-[color:var(--success)]'
                              : 'text-[color:var(--warning)]'
                        }`}>
                          <span className={`size-1.5 rounded-full ${
                            l.arquivado
                              ? 'bg-muted-foreground/60'
                              : l.ativo
                                ? 'bg-[color:var(--success)]'
                                : 'bg-[color:var(--warning)]'
                          }`} aria-hidden="true" />
                          {l.arquivado ? 'Arquivado' : l.ativo ? 'Ativo' : 'Pausado'}
                        </span>
                        {l.urlWhitePage ? (
                          <span className="text-[12px] font-medium text-[color:var(--brand-pink)]">Cloak</span>
                        ) : null}
                        {(l.dominio && !verifiedHosts.has(l.dominio)) || pixelMissing || pixelPaused ? (
                          <span
                            className="inline-flex items-center gap-1 text-[12px] font-medium text-[color:var(--warning)]"
                            title="Há configurações deste link que precisam de atenção. Abra Detalhes para revisar."
                          >
                            <TriangleAlert className="size-3" aria-hidden="true" />
                            {[l.dominio && !verifiedHosts.has(l.dominio), pixelMissing || pixelPaused].filter(Boolean).length} problema{[l.dominio && !verifiedHosts.has(l.dominio), pixelMissing || pixelPaused].filter(Boolean).length === 1 ? '' : 's'}
                          </span>
                        ) : null}
                      </div>

                      <p className="mt-1 truncate text-[12px] text-muted-foreground">
                        <span className="text-muted-foreground/60">https://{l.dominio || appHost}/go/</span>
                        <span className="text-brand-cyan/90">{l.slug}</span>
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px] text-muted-foreground">
                        <span className="tabular-nums"><CountUp value={clicks} /> cliques</span>
                        <span className="tabular-nums"><CountUp value={convs} /> conversões</span>
                        {convRate !== null ? (
                          <span className="tabular-nums text-foreground/80">{convRate.toFixed(1).replace('.', ',')}%</span>
                        ) : null}
                        {revenueEntries.map(([cur, cents]) => (
                          <span key={cur} className="font-medium tabular-nums text-foreground" title={`Receita atribuída a este link em ${cur}`}>
                            {formatMoney(cents, cur)}
                          </span>
                        ))}
                      </div>

                      <details className="mt-3 text-[12px] text-muted-foreground">
                        <summary className="w-fit cursor-pointer select-none font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
                          Detalhes
                        </summary>
                        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 border-l border-border/50 pl-3">
                          <span>{l.variantes.length} versão{l.variantes.length === 1 ? '' : 'ões'}</span>
                          {l.urlWhitePage ? <span>Cloaker ativo</span> : null}
                          {l.pixelSlug ? (
                            <span className={pixelMissing || pixelPaused ? 'text-[color:var(--warning)]' : ''}>
                              Pixel: {l.pixelSlug}{pixelMissing ? ' · não existe' : pixelPaused ? ' · pausado' : ''}
                            </span>
                          ) : null}
                          {l.dominio && !verifiedHosts.has(l.dominio) ? (
                            <span className="text-[color:var(--warning)]">Domínio não verificado</span>
                          ) : null}
                          {l.paises.length > 0 ? <span>Países: {l.paises.join(', ')}</span> : null}
                          {l.idiomas.length > 0 ? <span>Idiomas: {l.idiomas.join(', ')}</span> : null}
                        </div>
                      </details>

                      {l.variantes.length >= 2 && (
                        <details className="mt-2 text-[12px] text-muted-foreground">
                          <summary className="w-fit cursor-pointer select-none font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
                            Teste A/B · {l.variantes.length} variantes
                          </summary>
                          <div className="mt-2 flex flex-col gap-2 border-l border-border/50 pl-3">
                            {l.variantes.map((v) => {
                              const share = convs > 0 ? (v.conversions / convs) * 100 : 0
                              return (
                                <div key={v.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 text-[12px]">
                                  <span className="truncate text-foreground/80" title={v.nome}>{v.nome}</span>
                                  <span className="tabular-nums text-right">peso {v.peso}% · {convs > 0 ? `${share.toFixed(0)}% conv.` : <><CountUp value={v.conversions} /> conv.</>}</span>
                                  <div className="col-span-2 h-px overflow-hidden bg-border/45" role="img" aria-label={`${v.nome}: peso ${v.peso}%, ${v.conversions} de ${convs} conversões`}>
                                    <div className="h-full bg-brand-cyan/70" style={{ width: `${Math.min(100, share)}%` }} />
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5 self-start lg:pt-0.5">
                    <button type="button" onClick={() => copyUrl(l)} className="btn-secondary px-3 py-1.5 text-xs" title="Copiar link">
                      {copied === l.slug ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                      {copied === l.slug ? 'Copiado' : 'Copiar'}
                    </button>
                    <button type="button" onClick={() => setEditing(l)} className="btn-ghost px-2.5 py-1.5 text-xs" title="Editar link">
                      <Pencil className="size-3.5" />
                      Editar
                    </button>
                    <details className="relative">
                      <summary className="list-none cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary/35 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20" aria-label={`Mais ações para ${l.nome}`}>
                        <MoreHorizontal className="size-4" />
                      </summary>
                      <div className="absolute right-0 z-20 mt-2 w-48 overflow-hidden rounded-xl border border-border/70 bg-card p-1 shadow-lg">
                        <button type="button" onClick={() => toggleAtivo(l)} disabled={busy} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/45 hover:text-foreground disabled:opacity-40">
                          <Power className="size-3.5" /> {l.ativo ? 'Pausar link' : 'Ativar link'}
                        </button>
                        <button type="button" onClick={() => duplicateLink(l)} disabled={busy} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/45 hover:text-foreground disabled:opacity-40">
                          <CopyPlus className="size-3.5" /> Duplicar
                        </button>
                        <button type="button" onClick={() => setQrFor(l.slug)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/45 hover:text-foreground">
                          <QrCode className="size-3.5" /> Ver QR Code
                        </button>
                        <button type="button" onClick={() => downloadQr(l)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/45 hover:text-foreground">
                          <Download className="size-3.5" /> Baixar QR
                        </button>
                        <button type="button" onClick={() => toggleArquivado(l)} disabled={busy} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/45 hover:text-foreground disabled:opacity-40">
                          {l.arquivado ? <ArchiveRestore className="size-3.5" /> : <Archive className="size-3.5" />} {l.arquivado ? 'Restaurar' : 'Arquivar'}
                        </button>
                        <div className="my-1 border-t border-border/50" />
                        <button type="button" onClick={() => setDeleting(l.slug)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-destructive hover:bg-destructive/10">
                          <Trash2 className="size-3.5" /> Excluir
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {qrFor && (() => {
        const link = links.find((item) => item.slug === qrFor)
        if (!link) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/72 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={`QR Code de ${link.nome}`} onClick={(event) => { if (event.target === event.currentTarget) setQrFor(null) }}>
            <div className="w-full max-w-sm rounded-2xl border border-border/70 bg-background p-5 shadow-xl">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-foreground">QR Code</h3>
                  <p className="mt-3 truncate text-sm font-medium text-foreground">{link.nome}</p>
                  <p className="mt-1 break-all text-xs leading-relaxed text-muted-foreground">{publicUrl(link)}</p>
                </div>
                <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/40" onClick={() => setQrFor(null)} aria-label="Fechar QR Code">×</button>
              </div>
              <div className="mt-5 flex min-h-48 items-center justify-center p-2">
                {qrDataUrl ? (
                  <div className="rounded-xl bg-white p-3">
                    <img src={qrDataUrl} alt={`QR Code para ${link.nome}`} className="size-40" />
                  </div>
                ) : (
                  <div className="flex size-40 items-center justify-center rounded-xl border border-border/60 bg-secondary/20 text-xs text-muted-foreground">Gerando QR...</div>
                )}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2 max-sm:grid-cols-1">
                <button type="button" className="btn-secondary justify-center" onClick={() => copyUrl(link)}><Copy className="size-3.5" /> Copiar URL</button>
                <button type="button" className="btn-primary justify-center" onClick={() => downloadQr(link)}><Download className="size-3.5" /> Baixar PNG</button>
              </div>
            </div>
          </div>
        )
      })()}

      {(() => {
        const dl = deleting ? links.find((l) => l.slug === deleting) : undefined
        const dlClicks = dl ? dl.variantes.reduce((s, v) => s + v.clicks, 0) : 0
        const dlConvs = dl ? dl.variantes.reduce((s, v) => s + v.conversions, 0) : 0
        const dlTraffic = dlClicks > 0 || dlConvs > 0
        return (
          <ConfirmDialog
            open={Boolean(dl)}
            title={dl ? `Excluir "${dl.nome}"?` : ''}
            description={
              dl && (
                <div className="space-y-3">
                  <p>Essa ação é permanente e a URL <strong className="text-foreground">/go/{dl.slug}</strong> deixará de funcionar imediatamente.</p>
                  {dlTraffic && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-destructive">Este link possui tráfego registrado.</p>
                      <p className="text-xs tabular-nums text-muted-foreground">{dlClicks} cliques · {dlConvs} conversões</p>
                    </div>
                  )}
                </div>
              )
            }
            confirmLabel="Excluir link"
            confirmText={dl && dlTraffic ? dl.nome : undefined}
            busy={deleteBusy}
            onConfirm={async () => { if (deleting) await handleDelete(deleting) }}
            onClose={() => setDeleting(null)}
            tone="danger"
            appearance="quiet"
          />
        )
      })()}

      {(creating || editing) && (
        <LinkEditor
          link={editing}
          domains={checkoutDomains}
          appHost={appHost}
          presetDominio={presetDominio}
          onClose={() => {
            setCreating(false)
            setEditing(null)
            setPresetDominio(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            setPresetDominio(null)
            void mutate()
          }}
        />
      )}
    </div>
  )
}
