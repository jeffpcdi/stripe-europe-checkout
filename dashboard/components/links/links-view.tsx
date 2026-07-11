'use client'

import { useEffect, useMemo, useState } from 'react'
import { usePersistedState } from '@/lib/use-persisted-state'
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
} from 'lucide-react'
import QRCodeLib from 'qrcode'
import { useLinks, useDomains, usePixels, apiSend } from '@/lib/api'
import type { CheckoutLink } from '@/lib/types'
import { formatMoney } from '@/lib/format'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { LinkEditor } from './link-editor'

// Item 64: opções de ordenação da lista de links
type SortKey = 'recentes' | 'nome' | 'cliques' | 'conversoes'
const SORT_LABELS: Record<SortKey, string> = {
  recentes: 'Mais recentes',
  nome: 'Nome (A–Z)',
  cliques: 'Mais cliques',
  conversoes: 'Mais conversões',
}

const LINK_STEPS: TutorialStep[] = [
  {
    title: 'O que é um link de checkout',
    body: (
      <>
        É um link <code>/go/seu-slug</code> que você usa nos anúncios. Ele rastreia o clique, aplica
        cloaker e split A/B quando você quiser, e leva o visitante ao checkout certo.
      </>
    ),
  },
  {
    title: '1. Crie o link',
    body: (
      <>
        Clique em <strong>Novo link</strong>, dê um nome e defina o <code>slug</code> (o final da URL).
        Adicione uma ou mais <strong>variantes</strong> de destino para testar ofertas (split A/B).
      </>
    ),
    tip: 'Com 2+ variantes, o tráfego é dividido automaticamente e você compara a conversão de cada uma.',
  },
  {
    title: '2. Use domínio próprio (opcional)',
    body: (
      <>
        Se você verificou um domínio na aba <strong>Domínios</strong>, escolha-o aqui para o link sair
        com a sua marca em vez do domínio padrão.
      </>
    ),
  },
  {
    title: '3. Cloaker e segmentação',
    body: (
      <>
        Configure página branca (white page), países e idiomas permitidos. Assim, quem não é público-alvo
        (ou o robô de revisão) vê a página segura, e o comprador real vê a oferta.
      </>
    ),
    tip: 'Copie a URL pronta pelo botão de copiar ou gere um QR code para mídia offline.',
  },
]

export function LinksView() {
  const { data, isLoading, mutate } = useLinks()
  const { data: domainsData } = useDomains()
  const { data: pixelsData } = usePixels()
  const [editing, setEditing] = useState<CheckoutLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Item 76: para links com tráfego, a exclusão exige digitar o nome do link
  const [deleteText, setDeleteText] = useState('')
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
  // Item 71: QR code em popover glass por link — gerado LOCALMENTE (a URL do
  // link nunca sai para um serviço de terceiros)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)
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
    const filtered = q
      ? links.filter(
          (l) =>
            l.nome.toLowerCase().includes(q) ||
            l.slug.toLowerCase().includes(q) ||
            (l.dominio ?? '').toLowerCase().includes(q),
        )
      : links
    const clicksOf = (l: CheckoutLink) => l.variantes.reduce((s, v) => s + v.clicks, 0)
    const convsOf = (l: CheckoutLink) => l.variantes.reduce((s, v) => s + v.conversions, 0)
    return [...filtered].sort((a, b) => {
      if (sortBy === 'nome') return a.nome.localeCompare(b.nome, 'pt-BR')
      if (sortBy === 'cliques') return clicksOf(b) - clicksOf(a)
      if (sortBy === 'conversoes') return convsOf(b) - convsOf(a)
      return (b.criadoEm || '').localeCompare(a.criadoEm || '') // recentes
    })
  }, [links, query, sortBy])

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
    await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
    setDeleting(null)
    setDeleteText('')
    mutate()
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {links.length} link{links.length === 1 ? '' : 's'} de checkout
          {query.trim() && visibleLinks.length !== links.length && (
            <span className="ml-1 text-xs">({visibleLinks.length} no filtro)</span>
          )}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Item 64: busca + ordenação (só aparecem com 2+ links) */}
          {links.length > 1 && (
            <>
              <label className="relative">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Buscar link…"
                  aria-label="Buscar link por nome, slug ou domínio"
                  className="w-40 rounded-lg border border-border bg-input py-2 pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring sm:w-48"
                />
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
          <TutorialButton onClick={() => setShowTutorial(true)} />
          <button
            type="button"
            data-tour="links-new"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="size-4" /> Novo link
          </button>
        </div>
      </div>

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como criar seus links de checkout"
        steps={LINK_STEPS}
      />

      {links.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Link2 className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-pretty">
            Nenhum link ainda. Crie um link /go/slug com split A/B, cloak e domínio próprio.
          </p>
          {/* Item 53: estado vazio guiado — CTA de criação + tutorial */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-lg bg-brand-cyan px-3 py-1.5 text-xs font-semibold text-black transition-all hover:brightness-105 active:scale-[0.98]"
            >
              Criar primeiro link
            </button>
            <button
              type="button"
              onClick={() => setShowTutorial(true)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Ver tutorial
            </button>
          </div>
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
            <GlassCard className="p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Nenhum link corresponde a &quot;{query}&quot;.
              </p>
            </GlassCard>
          )}
          {visibleLinks.map((l) => {
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
            // Item 76: link com tráfego exige confirmação digitada para excluir
            const hasTraffic = clicks > 0 || convs > 0
            const busy = busySlug === l.slug
            return (
              /* Item 69: hover eleva com sheen; slug em mono ciano */
              <GlassCard
                key={l.slug}
                className="sheen p-4 transition-transform duration-150 hover:-translate-y-0.5"
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
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          l.ativo
                            ? 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
                            : 'bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        {l.ativo ? 'Ativo' : 'Pausado'}
                      </span>
                      {l.urlWhitePage && (
                        <span className="rounded-md bg-[color:var(--brand-pink)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--brand-pink)]">
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
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      https://{l.dominio || appHost}/go/
                      <span className="text-primary">{l.slug}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {l.variantes.length} variante{l.variantes.length === 1 ? '' : 's'}
                      </span>
                      <span className="tabular-nums">{clicks} cliques</span>
                      <span className="tabular-nums">{convs} conversões</span>
                      {/* Item 65: taxa de conversão + receita por moeda */}
                      {convRate !== null && (
                        <span className="tabular-nums" title="Conversões ÷ cliques">
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
                        real nas conversões de cada variante */}
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
                                className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-secondary/60"
                                role="img"
                                aria-label={`${v.nome}: peso ${v.peso}%, ${v.conversions} de ${convs} conversões`}
                              >
                                {/* trilho: peso configurado */}
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/25"
                                  style={{ width: `${Math.min(100, v.peso)}%` }}
                                />
                                {/* preenchimento: participação real nas conversões */}
                                <div
                                  className="absolute inset-y-0 left-0 rounded-full bg-[color:var(--brand-cyan)]/70"
                                  style={{ width: `${Math.min(100, share)}%` }}
                                />
                              </div>
                              <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
                                peso {v.peso}% · {convs > 0 ? `${share.toFixed(0)}% das conv.` : `${v.conversions} conv.`}
                              </span>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                  </div>
                  {/* data-tour repete por card; o tour destaca o 1º (querySelector) */}
                  <div className="relative flex shrink-0 items-center gap-1" data-tour="links-qr">
                    {/* Item 62: pausar/ativar direto no card (otimista, sem abrir o editor) */}
                    <button
                      type="button"
                      onClick={() => toggleAtivo(l)}
                      disabled={busy}
                      className={`rounded-md p-2 transition-colors hover:bg-secondary disabled:opacity-40 ${
                        l.ativo
                          ? 'text-[color:var(--success)] hover:text-[color:var(--success)]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      aria-label={l.ativo ? `Pausar o link ${l.nome}` : `Ativar o link ${l.nome}`}
                      aria-pressed={l.ativo}
                      title={l.ativo ? 'Pausar link' : 'Ativar link'}
                    >
                      <Power className="size-4" />
                    </button>
                    {/* Item 69: testar o /go em nova aba (conta como clique real) */}
                    <a
                      href={publicUrl(l)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label={`Abrir ${publicUrl(l)} em nova aba`}
                      title="Abrir /go em nova aba (atenção: conta como clique)"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                    {/* Item 63: duplicar link (cópia pausada com contadores zerados) */}
                    <button
                      type="button"
                      onClick={() => duplicateLink(l)}
                      disabled={busy}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-40"
                      aria-label={`Duplicar o link ${l.nome}`}
                      title="Duplicar link (a cópia nasce pausada)"
                    >
                      <CopyPlus className="size-4" />
                    </button>
                    {/* Item 70: morph clipboard → check com rotação spring */}
                    <button
                      type="button"
                      onClick={() => copyUrl(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Copiar URL"
                    >
                      {copied === l.slug ? (
                        <Check className="anim-pop-in size-4 text-[color:var(--success)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    {/* Item 71: QR code em popover glass */}
                    <button
                      type="button"
                      onClick={() => setQrFor(qrFor === l.slug ? null : l.slug)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Ver QR code"
                      aria-expanded={qrFor === l.slug}
                    >
                      <QrCode className="size-4" />
                    </button>
                    {qrFor === l.slug && (
                      <div className="glass glass-thick anim-pop-in absolute right-0 top-11 z-20 flex flex-col items-center gap-2 p-3">
                        {qrDataUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={qrDataUrl || "/placeholder.svg"}
                            alt={`QR code do link ${l.nome}`}
                            width={140}
                            height={140}
                            className="rounded-md"
                          />
                        ) : (
                          <div className="flex size-[140px] items-center justify-center rounded-md bg-secondary/60">
                            <QrCode className="size-6 animate-pulse text-muted-foreground" aria-hidden="true" />
                          </div>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground">/go/{l.slug}</span>
                        <button
                          type="button"
                          onClick={() => downloadQr(l)}
                          disabled={!qrDataUrl}
                          className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
                        >
                          <Download className="size-3" aria-hidden="true" /> Baixar PNG
                        </button>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Editar link"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDeleting(l.slug)
                        setDeleteText('')
                      }}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Excluir link"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {deleting === l.slug && (
                  <div className="mt-3 flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-sm text-foreground">
                      Excluir <strong>{l.nome}</strong>? A URL /go/{l.slug} deixa de funcionar.
                      {hasTraffic && (
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {/* Item 76: proteção extra — este link já tem tráfego real */}
                          Este link já registrou {clicks} clique{clicks === 1 ? '' : 's'} e {convs}{' '}
                          conversõ{convs === 1 ? 'ão' : 'es'}. Digite o nome do link para confirmar.
                        </span>
                      )}
                    </p>
                    <div className="flex flex-wrap items-center justify-end gap-2">
                      {hasTraffic && (
                        <input
                          type="text"
                          value={deleteText}
                          onChange={(e) => setDeleteText(e.target.value)}
                          placeholder={l.nome}
                          aria-label={`Digite "${l.nome}" para confirmar a exclusão`}
                          className="w-full flex-1 rounded-md border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-destructive sm:w-auto"
                        />
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          setDeleting(null)
                          setDeleteText('')
                        }}
                        className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(l.slug)}
                        disabled={hasTraffic && deleteText.trim() !== l.nome}
                        className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}

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
