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
  Globe,
  Languages,
  QrCode,
  TriangleAlert,
  Search,
  CopyPlus,
  ExternalLink,
  Power,
  Radio,
  Download,
  Archive,
  ArchiveRestore,
} from 'lucide-react'
import QRCodeLib from 'qrcode'
import { useLinks, useDomains, usePixels, apiSend } from '@/lib/api'
import type { CheckoutLink } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
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

  const appHost = domainsData?.appHost ?? ''
  const links = data?.links ?? []
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

  // Item 62: toggle ativo/pausado inline com atualização otimista.
  // O save() do Express faz merge parcial — basta enviar { slug, ativo }.
  async function toggleAtivo(l: CheckoutLink) {
    setBusySlug(l.slug)
    const optimistic = { links: links.map((x) => (x.slug === l.slug ? { ...x, ativo: !l.ativo } : x)) }
    try {
      await mutate(
        async () => {
          await apiSend('/api/links', 'POST', { slug: l.slug, ativo: !l.ativo })
          return undefined // revalida do servidor
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: true },
      )
    } finally {
      setBusySlug(null)
    }
  }

  // Item 531: contagem de arquivados (para o botão só aparecer quando existem)
  const archivedCount = useMemo(() => links.filter((l) => l.arquivado).length, [links])

  // Item 531: arquivar/desarquivar — merge-patch { slug, arquivado } no save()
  async function toggleArquivado(l: CheckoutLink) {
    setBusySlug(l.slug)
    try {
      await apiSend('/api/links', 'POST', { slug: l.slug, arquivado: !l.arquivado })
      await mutate()
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
          peso: v.peso,
        })),
      })
      mutate()
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
    setBulkBusy(true)
    try {
      for (const slug of selected) {
        await apiSend('/api/links', 'POST', { slug, ativo })
      }
      mutate()
      clearSelection()
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
    setBulkBusy(true)
    try {
      for (const slug of selected) {
        await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
      }
      mutate()
      clearSelection()
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFor, appHost])

  function publicUrl(l: CheckoutLink) {
    const host = l.dominio || appHost
    return `https://${host}/go/${l.slug}`
  }

  async function copyUrl(l: CheckoutLink) {
    await navigator.clipboard.writeText(publicUrl(l))
    setCopied(l.slug)
    toast.success('Link copiado')
    setTimeout(() => setCopied(null), 1500)
  }

  // Item 70: baixa o QR gerado no cliente como PNG (sem serviço externo).
  // Regenera em alta resolução para impressão/material de anúncio.
  async function downloadQr(l: CheckoutLink) {
    const dataUrl = await QRCodeLib.toDataURL(publicUrl(l), {
      width: 512,
      margin: 2,
      color: { dark: '#0d0d10', light: '#ffffff' },
    })
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = `qr-${l.slug}.png`
    a.click()
  }

  async function handleDelete(slug: string) {
    const link = links.find((l) => l.slug === slug)
    setDeleteBusy(true)
    try {
      await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
      toast.success(`Link "${link?.nome ?? slug}" excluído.`)
      setDeleting(null)
      mutate()
    } catch (err) {
      toast.error('Falha ao excluir o link.', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setDeleteBusy(false)
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
      <div className="relative py-1 flex flex-wrap items-center justify-between gap-4 border-b border-border/10 bg-background transition-all duration-300 shadow-[0_4px_30px_rgba(0,0,0,0.1)]">
        <p className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <span className="flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-secondary/80 text-foreground text-xs tabular-nums font-semibold border border-border/50">
            <CountUp value={links.length} />
          </span>
          link{links.length === 1 ? '' : 's'} de venda
          {query.trim() && visibleLinks.length !== links.length && (
            <span className="ml-1 flex items-center text-xs animate-in fade-in slide-in-from-bottom-2 duration-300">
               <span className="mr-1 text-muted-foreground/50">/</span> {visibleLinks.length} no filtro
            </span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Item 64: busca + ordenação (só aparecem com 2+ links) */}
          {links.length > 1 && (
            <>
              <label className="relative group">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground transition-all duration-300 group-focus-within:text-[color:var(--brand-cyan)] group-focus-within:-translate-y-[60%] group-focus-within:scale-110"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar link…"
                  aria-label="Buscar link por nome, slug ou domínio"
                  className="w-40 rounded-lg border border-border bg-input/40 py-2 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground transition-all duration-300 ease-out focus:w-56 focus:bg-secondary/60 focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-cyan)] focus:shadow-[0_0_20px_rgba(37,244,238,0.1)] sm:w-48 sm:focus:w-64 backdrop-blur-md"
                />
                <div className="pointer-events-none absolute inset-0 rounded-lg bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-pink)] opacity-0 blur-md transition-opacity duration-300 group-focus-within:opacity-20" />
              </label>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortKey)}
                aria-label="Ordenar links"
                className="rounded-lg border border-border bg-input px-2 py-2 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
            </>
          )}
          {archivedCount > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className={`group flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs transition-all duration-500 ease-out ${
                showArchived
                  ? 'border-[color:var(--brand-cyan)]/50 bg-[color:var(--brand-cyan)]/10 text-[color:var(--brand-cyan)] shadow-[0_0_15px_rgba(37,244,238,0.2)]'
                  : 'border-border bg-secondary/20 text-muted-foreground hover:bg-secondary/80 hover:text-foreground'
              }`}
              data-tooltip="Links arquivados ficam fora da lista e do /go, com histórico preservado"
            >
              <Archive className={`size-3.5 transition-transform duration-300 ${showArchived ? 'rotate-12 scale-110' : 'group-hover:-translate-y-0.5'}`} aria-hidden="true" />
              Arquivados ({archivedCount})
            </button>
          )}
          <button
            type="button"
            data-tour="links-new"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-brand-cyan px-4 py-2 text-sm font-semibold text-black transition-all hover:opacity-90 active:scale-95"
          >
            <Plus className="size-4" />
            Novo link
          </button>
        </div>
      </div>

      {links.length === 0 ? (
        <GlassCard className="flex flex-col items-center justify-center gap-4 p-12 text-center border-dashed border-border/80">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-brand-cyan/10 text-brand-cyan">
            <Link2 className="size-7" />
          </div>

          <div className="flex flex-col items-center gap-1 max-w-sm">
            <h3 className="text-base font-semibold text-foreground">
              Nenhum link criado
            </h3>
            <p className="text-xs text-muted-foreground">
              Crie links de checkout para rastrear cliques, vendas e enviar dados ao TikTok.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-2 flex items-center gap-1.5 rounded-lg bg-foreground px-4 py-2 text-xs font-semibold text-background hover:opacity-90 transition-opacity"
          >
            <Plus className="size-3.5" />
            Criar Primeiro Link
          </button>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3" data-tour="links-list">
          {/* Item 72: barra de ações em massa (aparece quando há seleção) */}
          {selected.size > 0 && (
            <div
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/60 px-3 py-2"
              role="toolbar"
              aria-label="Ações em massa nos links selecionados"
            >
              <span className="text-xs text-muted-foreground tabular-nums">
                {selected.size} selecionado{selected.size === 1 ? '' : 's'}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => bulkSetAtivo(true)}
                  disabled={bulkBusy}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  Ativar
                </button>
                <button
                  type="button"
                  onClick={() => bulkSetAtivo(false)}
                  disabled={bulkBusy}
                  className="rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  Pausar
                </button>
                <button
                  type="button"
                  onClick={bulkDelete}
                  disabled={bulkBusy}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors disabled:opacity-40 ${
                    confirmBulkDelete
                      ? 'bg-destructive text-white hover:opacity-90'
                      : 'border border-destructive/40 text-destructive hover:bg-destructive/10'
                  }`}
                >
                  {confirmBulkDelete ? `Confirmar exclusão de ${selected.size}` : 'Excluir'}
                </button>
                <button
                  type="button"
                  onClick={clearSelection}
                  disabled={bulkBusy}
                  className="rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                >
                  Limpar
                </button>
              </div>
            </div>
          )}
          {visibleLinks.length === 0 && (
            <GlassCard className="p-6 text-center shadow-[0_0_15px_rgba(37,244,238,0.15)] transition-all">
              <p className="text-sm text-muted-foreground">
                Nenhum link corresponde a &quot;{query}&quot;.
              </p>
            </GlassCard>
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
              /* A5.2: hover eleva com borda ciano 40% + shadow-lg; ações do
                 card aparecem no hover em desktop (sempre visíveis no mobile,
                 e também com foco de teclado via focus-within) */
              /* V2-87: spotlight que segue o cursor nos cards de link */
              <GlassCard
                key={l.slug}
                spotlight
                className="relative group flex-col p-5 border-l-[3px] border-l-transparent transition-all duration-500 ease-out hover:-translate-y-1.5 hover:scale-[1.005] hover:border-l-[color:var(--brand-cyan)] hover:shadow-[0_20px_40px_-10px_rgba(37,244,238,0.15)] animate-in fade-in slide-in-from-bottom-8 fill-mode-both"
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {/* Item 72: checkbox de seleção (só aparece com 2+ links) */}
                    {links.length > 1 && (
                      <input
                        type="checkbox"
                        checked={selected.has(l.slug)}
                        onChange={() => toggleSelect(l.slug)}
                        aria-label={`Selecionar o link ${l.nome}`}
                        className="mt-0.5 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                      />
                    )}
                    <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{l.nome}</h3>
                      {/* A5.4: badge de estado unificado com .status-dot —
                          ativo (verde pulsante), pausado (âmbar), arquivado (neutro) */}
                      <span
                        className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold transition-all duration-300 ${
                          l.arquivado
                            ? 'bg-muted/30 text-muted-foreground border border-muted/50 backdrop-blur-sm'
                            : l.ativo
                              ? 'bg-[color:var(--success)]/10 text-[color:var(--success)] border border-[color:var(--success)]/30 drop-shadow-[0_0_10px_var(--success-light)]'
                              : 'bg-[color:var(--warning)]/10 text-[color:var(--warning)] border border-[color:var(--warning)]/30 drop-shadow-[0_0_10px_var(--warning)] backdrop-blur-sm'
                        }`}
                      >
                        <span className="relative flex h-2 w-2 items-center justify-center">
                          {l.ativo && (
                            <>
                              <span className="absolute inline-flex h-full w-full animate-[ping_2s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-[color:var(--success)] opacity-75" />
                              <span className="absolute inline-flex h-full w-full animate-[ping_2.5s_cubic-bezier(0,0,0.2,1)_infinite_0.5s] rounded-full bg-[color:var(--success)] opacity-40" />
                            </>
                          )}
                          <span
                            className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                              l.arquivado
                                ? 'bg-muted-foreground/50'
                                : l.ativo
                                  ? 'bg-[color:var(--success)]'
                                  : 'bg-[color:var(--warning)]'
                            }`}
                            aria-hidden="true"
                          />
                        </span>
                        {l.arquivado ? 'Arquivado' : l.ativo ? 'Ativo' : 'Pausado'}
                      </span>
                      {l.urlWhitePage && (
                        <span className="rounded-full bg-gradient-to-r from-[color:var(--brand-pink)]/20 to-purple-500/20 border border-[color:var(--brand-pink)]/30 px-2 py-0.5 text-[11px] font-bold text-[color:var(--brand-pink)] drop-shadow-[0_0_8px_rgba(255,105,180,0.5)]">
                          Cloak
                        </span>
                      )}
                      {/* Aviso: o link usa domínio próprio que ainda não verificou — a URL vai dar erro */}
                      {l.dominio && !verifiedHosts.has(l.dominio) && (
                        <span
                          className="flex items-center gap-1 rounded-md bg-[color:var(--warning)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--warning)]"
                          title={`O domínio ${l.dominio} ainda não foi verificado na aba Domínios — este link não funciona até verificar.`}
                        >
                          <TriangleAlert className="size-3" aria-hidden="true" /> domínio não verificado
                        </span>
                      )}
                      {/* Item 68: pixel associado ao link, com alerta se sumiu ou está pausado */}
                      {l.pixelSlug && (
                        <span
                          className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                            pixelMissing || pixelPaused
                              ? 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'
                              : 'bg-secondary/60 text-muted-foreground'
                          }`}
                          title={
                            pixelMissing
                              ? `O pixel "${l.pixelSlug}" não existe mais — os eventos deste link não disparam.`
                              : pixelPaused
                                ? `O pixel "${l.pixelSlug}" está pausado — os eventos deste link não disparam.`
                                : `Eventos deste link disparam no pixel "${l.pixelSlug}".`
                          }
                        >
                          <Radio className="size-3" aria-hidden="true" />
                          {l.pixelSlug}
                          {pixelMissing && ' (não existe)'}
                          {pixelPaused && ' (pausado)'}
                        </span>
                      )}
                    </div>
                    {/* A5.1: prefixo esmaecido, slug em destaque ciano */}
                    <p className="mt-1 truncate font-mono text-xs">
                      <span className="text-muted-foreground/50">
                        https://{l.dominio || appHost}/go/
                      </span>
                      <span className="text-primary">{l.slug}</span>
                    </p>
                    {/* A5.3: mini-barra de conversão cliques→conversões */}
                    {clicks > 0 && (
                      <div
                        className="mt-3 flex items-center gap-2 group/conv"
                        role="img"
                        aria-label={`${convs} conversões em ${clicks} cliques`}
                      >
                        <div className="h-1.5 w-32 overflow-hidden rounded-full bg-secondary shadow-inner">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-[color:var(--brand-cyan)] to-[color:var(--brand-pink)] transition-[width] duration-1000 ease-out group-hover/conv:drop-shadow-[0_0_5px_rgba(37,244,238,0.8)]"
                            style={{ width: `${Math.min(100, (convs / clicks) * 100)}%` }}
                          />
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-foreground/60 transition-colors group-hover/conv:text-[color:var(--brand-cyan)] group-hover/conv:drop-shadow-[0_0_5px_rgba(37,244,238,0.5)]">
                          {((convs / clicks) * 100).toFixed(1).replace('.', ',')}%
                        </span>
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {l.variantes.length} versão{l.variantes.length === 1 ? '' : 'ões'}
                      </span>
                      <span className="tabular-nums"><CountUp value={clicks} /> cliques</span>
                      <span className="tabular-nums"><CountUp value={convs} /> conversões</span>
                      {/* Item 65: taxa de conversão + receita por moeda */}
                      {convRate !== null && (
                        <span className="tabular-nums" data-tooltip="Conversões ÷ cliques">
                          {convRate.toFixed(1).replace('.', ',')}% conv.
                        </span>
                      )}
                      {revenueEntries.map(([cur, cents]) => (
                        <span
                          key={cur}
                          className="font-medium tabular-nums text-[color:var(--success)]"
                          title={`Receita atribuída a este link em ${cur}`}
                        >
                          {formatMoney(cents, cur)}
                        </span>
                      ))}
                      {l.paises.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Globe className="size-3" /> {l.paises.join(', ')}
                        </span>
                      )}
                      {l.idiomas.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Languages className="size-3" /> {l.idiomas.join(', ')}
                        </span>
                      )}
                    </div>
                    {/* Item 66: leitura rápida do A/B — peso configurado vs. participação
                        real nas conversões de cada versão */}
                    {l.variantes.length >= 2 && (
                      <div className="mt-3 flex flex-col gap-1.5">
                        {l.variantes.map((v) => {
                          const share = convs > 0 ? (v.conversions / convs) * 100 : 0
                          return (
                            <div key={v.id} className="flex items-center gap-2 text-[11px]">
                              <span className="w-24 truncate text-muted-foreground" title={v.nome}>
                                {v.nome}
                              </span>
                              <div
                                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/80 shadow-inner"
                                role="img"
                                aria-label={`${v.nome}: peso ${v.peso}%, ${v.conversions} de ${convs} conversões`}
                              >
                                {/* trilho: peso configurado */}
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/20"
                                  style={{ width: `${Math.min(100, v.peso)}%` }}
                                />
                                {/* preenchimento: participação real nas conversões */}
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-transparent via-[color:var(--brand-cyan)]/80 to-[color:var(--brand-cyan)] group-hover:drop-shadow-[0_0_5px_rgba(37,244,238,0.5)] transition-[width] duration-1000 ease-out"
                                  style={{ width: `${Math.min(100, share)}%` }}
                                />
                              </div>
                              <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                                peso {v.peso}% · {convs > 0 ? `${share.toFixed(0)}% das conv.` : <><CountUp value={v.conversions} /> conv.</>}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                  {/* Ações do Card: Limpas, diretas e sempre acessíveis */}
                  <div className="flex items-center gap-1">
                    {/* Botão Copiar */}
                    <button
                      type="button"
                      onClick={() => copyUrl(l)}
                      className="flex items-center gap-1 rounded-lg border border-border/70 bg-secondary/30 px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                      title="Copiar link"
                    >
                      {copied === l.slug ? (
                        <>
                          <Check className="size-3.5 text-brand-cyan" />
                          <span className="text-brand-cyan">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5" />
                          <span>Copiar</span>
                        </>
                      )}
                    </button>

                    {/* Botão Ativar/Pausar */}
                    <button
                      type="button"
                      onClick={() => toggleAtivo(l)}
                      disabled={busy}
                      className={`rounded-lg border border-border/70 p-1.5 text-xs transition-colors hover:bg-secondary disabled:opacity-40 ${
                        l.ativo
                          ? 'text-[color:var(--success)]'
                          : 'text-muted-foreground'
                      }`}
                      title={l.ativo ? 'Pausar link' : 'Ativar link'}
                      aria-label={l.ativo ? `Pausar link ${l.nome}` : `Ativar link ${l.nome}`}
                    >
                      <Power className="size-3.5" />
                    </button>

                    {/* Botão Editar */}
                    <button
                      type="button"
                      onClick={() => setEditing(l)}
                      className="rounded-lg border border-border/70 p-1.5 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      title="Editar link"
                      aria-label="Editar link"
                    >
                      <Pencil className="size-3.5" />
                    </button>

                    {/* Botão Excluir */}
                    <button
                      type="button"
                      onClick={() => setDeleting(l.slug)}
                      className="rounded-lg border border-border/70 p-1.5 text-xs text-muted-foreground transition-colors hover:bg-destructive/20 hover:text-destructive hover:border-destructive/40"
                      title="Excluir link"
                      aria-label="Excluir link"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </GlassCard>
            )
          })}
        </div>
      )}

      {(() => {
        const dl = deleting ? links.find((l) => l.slug === deleting) : undefined
        const dlClicks = dl ? dl.variantes.reduce((s, v) => s + v.clicks, 0) : 0
        const dlConvs = dl ? dl.variantes.reduce((s, v) => s + v.conversions, 0) : 0
        const dlTraffic = dlClicks > 0 || dlConvs > 0
        return (
          <>
            {/* Red Room Effect Backdrop */}
            {Boolean(dl) && (
              <div className="fixed inset-0 z-40 bg-red-950/20 backdrop-blur-md backdrop-saturate-150 animate-in fade-in duration-300 pointer-events-none" />
            )}
            <ConfirmDialog
              open={Boolean(dl)}
              title={dl ? `Excluir permanentemente "${dl.nome}"?` : ''}
              description={
                dl && (
                  <div className="flex flex-col gap-3 mt-2">
                    <p className="text-sm">
                      A URL <strong className="text-foreground">/go/{dl.slug}</strong> deixará de funcionar imediatamente, quebrando qualquer anúncio ativo.
                    </p>
                    {dlTraffic && (
                      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 mt-2">
                        <p className="text-xs text-red-200">
                          <TriangleAlert className="inline-block size-3.5 mr-1 mb-0.5 text-red-400" />
                          Este link possui tráfego ativo que <strong>será perdido</strong>:
                        </p>
                        <div className="mt-2 flex items-center gap-2 font-mono text-sm font-bold text-red-400">
                          <span className="rounded-md bg-red-950/50 px-2 py-1 shadow-inner border border-red-500/20">{dlClicks} cliques</span>
                          <span className="rounded-md bg-red-950/50 px-2 py-1 shadow-inner border border-red-500/20">{dlConvs} conversões</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              }
              confirmLabel="Excluir Permanentemente"
              confirmText={dl && dlTraffic ? dl.nome : undefined}
              busy={deleteBusy}
              onConfirm={() => deleting && handleDelete(deleting)}
              onClose={() => setDeleting(null)}
              tone="danger"
            />
          </>
        )
      })()}

      {(creating || editing) && (
        <LinkEditor
          link={editing}
          domains={domainsData?.domains ?? []}
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
            mutate()
          }}
        />
      )}
    </div>
  )
}
