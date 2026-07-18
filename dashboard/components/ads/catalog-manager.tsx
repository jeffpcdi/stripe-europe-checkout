'use client'

// Gerenciador de catálogos de produtos do TikTok — corpo extraído do antigo
// CatalogDialog (modal 3 cliques fundo) para virar página de nível superior
// no menu (Gestão → Catálogo). A lógica é a mesma; só o chrome de modal saiu.
//
// A integração de Ads NÃO publica campanhas de catálogo — então o
// fluxo aqui é: editar produtos na dashboard → publicar um feed CSV
// TikTok-ready numa URL pública (Blob) → o usuário cola essa URL UMA vez no
// Catalog Manager do TikTok como feed agendado. Toda edição aqui atualiza o
// feed (mesma URL), e o TikTok re-puxa no próximo ciclo.
//
// Telas: (1) lista de catálogos da conta; (2) detalhe com tabela de produtos
// editável, importação de CSV, download e publicação + passo a passo guiado.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download, Rocket,
  Copy, Check, AlertCircle, ChevronLeft, ExternalLink, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil, ImageIcon,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  adsCatalogImportCsv, apiSend,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogProduct, AdsCatalogSpecResponse, AdsCatalogSyncResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'

const CURRENCIES = ['USD', 'BRL', 'EUR', 'GBP', 'MXN', 'CAD', 'AUD', 'JPY']

// Colunas prioritárias mostradas na tabela compacta (o restante fica no editor
// lateral). São as que o TikTok exige + as de maior uso.
const PRIMARY_COLS = ['sku_id', 'title', 'availability', 'condition', 'price', 'image_link', 'link']

// Rótulos amigáveis em pt-BR para o editor (a chave crua do CSV vira só uma
// dica pequena). Mantém intuitivo para quem vende, sem esconder o nome técnico.
const FIELD_LABELS: Record<string, string> = {
  sku_id: 'ID do produto (SKU)',
  title: 'Título',
  description: 'Descrição',
  availability: 'Disponibilidade',
  condition: 'Condição',
  price: 'Preço',
  link: 'Link do produto',
  image_link: 'Link da imagem',
  brand: 'Marca',
  video_link: 'Link do vídeo',
  additional_image_link: 'Imagens adicionais',
  age_group: 'Faixa etária',
  color: 'Cor',
  gender: 'Gênero',
  google_product_category: 'Categoria (Google)',
  product_type: 'Tipo de produto',
  sale_price: 'Preço promocional',
  size: 'Tamanho',
  gtin: 'GTIN (código de barras)',
  mpn: 'Código do fabricante (MPN)',
}
// Exemplos de preenchimento para os campos que mais confundem.
const FIELD_PLACEHOLDERS: Record<string, string> = {
  sku_id: 'Ex.: SKU-001',
  title: 'Ex.: Camiseta branca algodão',
  description: 'Descrição curta do produto',
  price: 'Ex.: 9.99 BRL',
  link: 'https://sualoja.com/produto',
  image_link: 'https://sualoja.com/foto.jpg (≥ 500×500)',
  sale_price: 'Ex.: 7.99 BRL',
}

type CatalogSpec = AdsCatalogSpecResponse

export function CatalogManager({
  advertiserId: _advertiserId,
  advertiserLabel: _advertiserLabel,
}: {
  advertiserId: string
  advertiserLabel: string
}) {
  const { data: list, mutate: mutateList, isLoading: listLoading } = useAdsCatalogs(true)
  const { data: spec } = useAdsCatalogSpec(true)
  const { data: bc, mutate: mutateBc } = useAdsCatalogBusinessCenter(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const enabled = list?.enabled !== false

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-8 text-center">
        <AlertCircle className="size-6 text-warning" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">Persistência indisponível</p>
        <p className="max-w-md text-pretty text-xs text-muted-foreground">
          O banco de dados (Neon) não está configurado, então catálogos não podem ser salvos. Conecte o
          Neon nas configurações do projeto para usar este recurso.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <BusinessCenterBar bcId={bc?.bcId ?? ''} fromEnv={Boolean(bc?.fromEnv)} onChanged={mutateBc} />
      {selectedId ? (
        <CatalogDetail
          catalogId={selectedId}
          spec={spec ?? null}
          bcConfigured={Boolean(bc?.bcId)}
          onBack={() => {
            setSelectedId(null)
            mutateList()
          }}
          onDeleted={() => {
            setSelectedId(null)
            mutateList()
          }}
        />
      ) : (
        <CatalogList
          catalogs={list?.catalogs ?? []}
          spec={spec ?? null}
          loading={listLoading && !list}
          onOpen={setSelectedId}
          onChanged={mutateList}
        />
      )}
    </div>
  )
}

// ── Business Center (obrigatório para publicar no TikTok) ──────────────────
// O TikTok prende catálogos ao Business Center, não ao advertiser, e não há
// API para listar BCs — então o usuário informa o ID uma vez (persistido).
function BusinessCenterBar({
  bcId,
  fromEnv,
  onChanged,
}: {
  bcId: string
  fromEnv: boolean
  onChanged: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(bcId)
  const [busy, setBusy] = useState(false)
  const configured = Boolean(bcId)

  async function save() {
    setBusy(true)
    try {
      await apiSend('/api/ads/catalogs/business-center', 'POST', { bcId: value.trim() })
      toast.success('Business Center salvo')
      setEditing(false)
      onChanged()
    } catch (e) {
      toast.error('Falha ao salvar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background p-3">
        <div className="flex items-center gap-2 text-xs">
          <Building2 className={`size-4 ${configured ? 'text-primary' : 'text-muted-foreground'}`} aria-hidden="true" />
          {configured ? (
            <span className="text-foreground">
              Business Center <code className="rounded bg-secondary px-1.5 py-0.5 text-[11px]">{bcId}</code>
              {fromEnv && <span className="ml-1 text-[11px] text-muted-foreground">(do servidor)</span>}
            </span>
          ) : (
            <span className="text-pretty text-muted-foreground">
              Opcional agora: configure o Business Center quando for publicar direto no TikTok.
            </span>
          )}
        </div>
        <button
          type="button"
          className={configured ? 'btn-ghost text-xs' : 'btn-primary text-xs'}
          onClick={() => {
            setValue(bcId)
            setEditing(true)
          }}
        >
          {configured ? <Pencil className="size-3.5" aria-hidden="true" /> : <Building2 className="size-3.5" aria-hidden="true" />}
          {configured ? 'Alterar' : 'Configurar'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-background p-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-foreground">ID do Business Center</span>
        <input
          autoFocus
          className="input-base"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Ex.: 7012345678901234567"
          inputMode="numeric"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) save()
          }}
        />
      </label>
      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        Encontre em <strong className="text-foreground">TikTok Business Center → Configurações</strong>: o ID
        numérico aparece na URL (<code className="rounded bg-secondary px-1 py-0.5">bc_id=…</code>) e nos detalhes
        da conta. É o mesmo BC que contém sua conta de anúncio.
      </p>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing(false)} disabled={busy}>
          Cancelar
        </button>
        <button type="button" className="btn-primary text-xs" onClick={save} disabled={busy}>
          {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
          Salvar
        </button>
      </div>
    </div>
  )
}

// ── Tela 1: lista + criação ──────────────────────────────────────────────
function CatalogList({
  catalogs,
  spec,
  loading,
  onOpen,
  onChanged,
}: {
  catalogs: AdsCatalog[]
  spec: CatalogSpec | null
  loading: boolean
  onOpen: (id: string) => void
  onChanged: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [catalogType, setCatalogType] = useState('PRODUCT_CATALOG')
  const [country, setCountry] = useState('BR')
  const [busy, setBusy] = useState(false)

  const catalogTypes = spec?.catalogTypes ?? [{ value: 'PRODUCT_CATALOG', label: 'Produtos' }]
  const countries = spec?.countries ?? [{ code: 'BR', name: 'Brasil' }]

  async function handleCreate() {
    if (!name.trim()) return
    setBusy(true)
    try {
      const res = await apiSend<{ catalog: AdsCatalog }>('/api/ads/catalogs', 'POST', {
        name: name.trim(),
        currency,
        catalogType,
        country,
      })
      toast.success('Catálogo criado')
      setName('')
      setCreating(false)
      onChanged()
      onOpen(res.catalog.id)
    } catch (e) {
      toast.error('Falha ao criar catálogo', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Cada catálogo é criado no TikTok e fica pronto para uma campanha de vendas (DPA).
        </p>
        {!creating && (
          <button type="button" className="btn-primary shrink-0 text-xs" onClick={() => setCreating(true)}>
            <Plus className="size-3.5" aria-hidden="true" />
            Novo catálogo
          </button>
        )}
      </div>

      {creating && (
        <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
          <label className="flex flex-col gap-1 text-xs">
            <span className="font-medium text-foreground">Nome do catálogo</span>
            <input
              autoFocus
              className="input-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex.: Loja Verão 2026"
              maxLength={200}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) handleCreate()
              }}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Tipo</span>
              <select className="input-base" value={catalogType} onChange={(e) => setCatalogType(e.target.value)}>
                {catalogTypes.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">País principal</span>
              <select className="input-base" value={country} onChange={(e) => setCountry(e.target.value)}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs">
              <span className="font-medium text-foreground">Moeda</span>
              <select className="input-base" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-[11px] text-muted-foreground">
            A moeda precisa bater com a moeda padrão do catálogo no TikTok — todos os preços usarão ela. Tipo,
            país e moeda são definidos na criação do catálogo na plataforma.
          </p>
          <div className="flex items-center justify-end gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={() => setCreating(false)} disabled={busy}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={handleCreate} disabled={busy || !name.trim()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
              Criar
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : catalogs.length === 0 && !creating ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background p-8 text-center">
          <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm font-medium text-foreground">Nenhum catálogo ainda</p>
          <p className="max-w-md text-pretty text-xs text-muted-foreground">
            Crie um catálogo, adicione ou importe produtos e publique o feed para conectar ao TikTok.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {catalogs.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onOpen(c.id)}
                className="flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.productCount} produto{c.productCount === 1 ? '' : 's'} · {c.currency}
                    {c.country ? ` · ${c.country}` : ''}
                    {c.tiktokCatalogId ? ' · no TikTok' : c.feedUrl ? ' · feed publicado' : ' · rascunho'}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.tiktokCatalogId ? 'bg-success/15 text-success' : c.feedUrl ? 'bg-primary/15 text-primary' : 'bg-secondary text-muted-foreground'}`}>
                  {c.tiktokCatalogId ? 'No TikTok' : c.feedUrl ? 'Feed' : 'Rascunho'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Tela 2: detalhe (produtos + import + publicar) ────────────────────────
function CatalogDetail({
  catalogId,
  spec,
  bcConfigured,
  onBack,
  onDeleted,
}: {
  catalogId: string
  spec: CatalogSpec | null
  bcConfigured: boolean
  onBack: () => void
  onDeleted: () => void
}) {
  const { data, mutate, isLoading } = useAdsCatalogDetail(catalogId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<AdsCatalogProduct | 'new' | null>(null)
  const [publishing, setPublishing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [auditing, setAuditing] = useState(false)
  const [autoChecking, setAutoChecking] = useState(false)
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)
  // Ref síncrona: impede dois syncs concorrentes mesmo antes do React
  // aplicar setSyncing(true) (duplo toque no iPhone / salvar + botão manual).
  const syncLockRef = useRef(false)
  const auditAttemptsRef = useRef(0)

  const catalog = data?.catalog
  const products = data?.products ?? []
  const validCount = products.filter((p) => p.valid).length

  async function handleImport(file: File) {
    setImporting(true)
    try {
      const text = await file.text()
      const { summary } = await adsCatalogImportCsv(catalogId, text)
      toast.success(`${summary.imported} produto(s) importado(s)`, {
        hint: summary.invalid > 0 ? `${summary.invalid} com erros de validação — revise na tabela.` : undefined,
      })
      mutate()
    } catch (e) {
      toast.error('Falha ao importar CSV', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function handlePublish() {
    setPublishing(true)
    try {
      const res = await apiSend<{ feedUrl: string; published: number; skipped: number }>(
        `/api/ads/catalogs/${encodeURIComponent(catalogId)}/publish`, 'POST', {},
      )
      toast.success(`Feed publicado com ${res.published} produto(s)`, {
        hint: res.skipped > 0 ? `${res.skipped} pulado(s) por erros de validação.` : undefined,
      })
      mutate()
    } catch (e) {
      toast.error('Falha ao publicar o feed', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setPublishing(false)
    }
  }

  // Publica direto no TikTok: cria o catálogo (se preciso) e sobe os produtos.
  async function handleSyncTiktok() {
    if (syncLockRef.current) return
    if (!bcConfigured) {
      toast.info('Produto salvo, mas ainda não publicado', {
        hint: 'Configure o Business Center no topo da aba para publicar no TikTok.',
      })
      return
    }
    syncLockRef.current = true
    setSyncing(true)
    try {
      const res = await apiSend<AdsCatalogSyncResponse>(
        `/api/ads/catalogs/${encodeURIComponent(catalogId)}/sync-tiktok`, 'POST', {},
      )
      if (res.dryRun) {
        toast.info('Modo simulação: feed publicado, mas nada foi enviado ao TikTok', {
          hint: 'Desative o modo simulação em Operações para publicar de verdade.',
        })
      } else {
        toast.success(`Catálogo publicado no TikTok com ${res.published} produto(s)`, {
          hint: res.audit && res.audit.pending > 0 ? 'A análise será acompanhada automaticamente nesta tela.' : undefined,
        })
        // Um novo envio reinicia a janela de acompanhamento (até 12 consultas).
        auditAttemptsRef.current = 0
      }
      await mutate()
    } catch (e) {
      toast.error('Falha ao publicar no TikTok', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      syncLockRef.current = false
      setSyncing(false)
    }
  }

  async function handleRefreshAudit() {
    setAuditing(true)
    try {
      const res = await fetch(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, { credentials: 'include' })
      if (!res.ok) {
        const auditData = await res.json().catch(() => ({}))
        throw new Error(auditData.error || `Erro ${res.status}`)
      }
      await mutate()
    } catch (e) {
      toast.error('Falha ao atualizar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setAuditing(false)
    }
  }

  // Acompanha a análise agregada do TikTok sem exigir recarregar a página.
  // Intervalo conservador de 20 s, no máximo 12 tentativas (~4 min). Para ao
  // sair da tela, quando não há pendentes, quando atinge o limite ou em erro.
  useEffect(() => {
    const hasTikTokCatalog = Boolean(catalog?.tiktokCatalogId)
    const needsCheck = hasTikTokCatalog && (!catalog?.audit || (catalog.audit.pending ?? 0) > 0)
    if (!needsCheck || auditAttemptsRef.current >= 12) {
      setAutoChecking(false)
      return
    }

    setAutoChecking(true)
    let cancelled = false
    const timer = window.setTimeout(async () => {
      try {
        auditAttemptsRef.current += 1
        const res = await fetch(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, { credentials: 'include' })
        if (!res.ok) throw new Error(`Erro ${res.status}`)
        if (!cancelled) await mutate()
      } catch {
        // Falha silenciosa no polling: o botão manual continua disponível e
        // evita uma sequência de toasts por instabilidade temporária da API.
        if (!cancelled) setAutoChecking(false)
      }
    }, 20_000)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [catalogId, catalog?.tiktokCatalogId, catalog?.audit?.pending, catalog?.audit?.at, mutate])

  async function handleDelete() {
    if (!confirm('Excluir este catálogo e todos os produtos? Isso não pode ser desfeito.')) return
    try {
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}`, 'DELETE')
      toast.success('Catálogo excluído')
      onDeleted()
    } catch (e) {
      toast.error('Falha ao excluir', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  async function handleDeleteProduct(productId: string) {
    try {
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products/${encodeURIComponent(productId)}`, 'DELETE')
      mutate()
    } catch (e) {
      toast.error('Falha ao remover produto', { hint: e instanceof Error ? e.message : undefined })
    }
  }

  function copyFeedUrl() {
    if (!catalog?.feedUrl) return
    navigator.clipboard?.writeText(catalog.feedUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="btn-ghost text-xs" onClick={onBack}>
          <ChevronLeft className="size-3.5" aria-hidden="true" />
          Voltar
        </button>
        <button type="button" className="btn-ghost text-xs text-error" onClick={handleDelete}>
          <Trash2 className="size-3.5" aria-hidden="true" />
          Excluir catálogo
        </button>
      </div>

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="size-5 animate-spin" aria-hidden="true" />
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-background p-4">
            <div>
              <p className="text-sm font-semibold text-foreground">{catalog?.name}</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {products.length} produto{products.length === 1 ? '' : 's'} · {validCount} válido{validCount === 1 ? '' : 's'} · {catalog?.currency}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleImport(f)
                }}
              />
              <button type="button" className="btn-ghost text-xs" onClick={() => fileRef.current?.click()} disabled={importing}>
                {importing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                Importar CSV
              </button>
              <a
                className="btn-ghost text-xs"
                href={`/api/ads/catalogs/${encodeURIComponent(catalogId)}/export.csv`}
              >
                <Download className="size-3.5" aria-hidden="true" />
                Baixar CSV
              </a>
              <button type="button" className="btn-ghost text-xs" onClick={() => setEditing('new')}>
                <Plus className="size-3.5" aria-hidden="true" />
                Produto
              </button>
              <button
                type="button"
                className="btn-ghost text-xs"
                onClick={handlePublish}
                disabled={publishing || validCount === 0}
                title="Publicar só o feed CSV (URL pública) para usar como feed agendado manual"
              >
                {publishing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <UploadCloud className="size-3.5" aria-hidden="true" />}
                Feed manual
              </button>
              <button
                type="button"
                className="btn-primary text-xs"
                onClick={handleSyncTiktok}
                disabled={syncing || validCount === 0 || !bcConfigured}
                title={!bcConfigured ? 'Configure o Business Center acima para publicar no TikTok' : undefined}
              >
                {syncing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Rocket className="size-3.5" aria-hidden="true" />}
                {catalog?.tiktokCatalogId ? 'Atualizar no TikTok' : 'Publicar no TikTok'}
              </button>
            </div>
          </div>

          {/* Fluxo baseado apenas em estados reais retornados pelo backend. */}
          <CatalogProgress
            catalog={catalog}
            productCount={products.length}
            validCount={validCount}
            syncing={syncing}
          />

          {/* Aviso: BC não configurado bloqueia a publicação no TikTok */}
          {!bcConfigured && (
            <div className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/5 p-3 text-[11px] text-muted-foreground">
              <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
              <span className="text-pretty">
                Configure o <strong className="text-foreground">Business Center</strong> no topo desta aba para
                publicar o catálogo direto no TikTok. Sem ele, você ainda pode gerar o <strong className="text-foreground">feed manual</strong> e
                conectá-lo no Catalog Manager.
              </span>
            </div>
          )}

          {/* Status do catálogo no TikTok (quando já publicado) */}
          {catalog?.tiktokCatalogId && (
            <TiktokStatusPanel
              catalog={catalog}
              auditing={auditing}
              autoChecking={autoChecking}
              onRefresh={handleRefreshAudit}
            />
          )}

          {/* Alternativa manual: feed agendado (para quem não usa a publicação
              direta ou prefere conectar a URL à mão no Catalog Manager) */}
          {catalog?.feedUrl && (
            <details className="rounded-xl border border-border bg-background p-4">
              <summary className="cursor-pointer text-xs font-semibold text-foreground">
                Alternativa: feed agendado manual (URL pública)
              </summary>
              <div className="mt-3 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
                    {catalog.feedUrl}
                  </code>
                  <button type="button" className="btn-ghost shrink-0 px-2 py-2" onClick={copyFeedUrl} aria-label="Copiar URL">
                    {copied ? <Check className="size-3.5 text-success" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
                  </button>
                </div>
                <ol className="ml-4 list-decimal text-pretty text-[11px] leading-relaxed text-muted-foreground">
                  <li>Abra o <strong className="text-foreground">TikTok Business Center → Catalog Manager</strong> e crie/abra um catálogo.</li>
                  <li>Em <strong className="text-foreground">Data source → Scheduled feed</strong>, cole a URL acima e defina a frequência de atualização.</li>
                  <li>Cada vez que você editar produtos aqui e clicar em <strong className="text-foreground">Feed manual</strong>, a URL continua a mesma — o TikTok re-puxa sozinho.</li>
                </ol>
                <a
                  className="btn-ghost w-fit text-xs"
                  href="https://ads.tiktok.com/help/article?aid=10001006"
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="size-3.5" aria-hidden="true" />
                  Guia oficial do TikTok
                </a>
              </div>
            </details>
          )}

          {/* Tabela de produtos */}
          {products.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background p-8 text-center">
              <PackageOpen className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium text-foreground">Nenhum produto</p>
              <p className="max-w-md text-pretty text-xs text-muted-foreground">
                Importe o CSV do template do TikTok ou adicione produtos manualmente.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-left text-xs">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Status</th>
                    {PRIMARY_COLS.map((col) => (
                      <th key={col} className="whitespace-nowrap px-3 py-2 font-medium">{col}</th>
                    ))}
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-t border-border hover:bg-secondary/30">
                      <td className="px-3 py-2">
                        {p.valid ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                            <Check className="size-3" aria-hidden="true" /> ok
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2 py-0.5 text-[10px] font-semibold text-error"
                            title={p.errors.map((e) => `${e.field}: ${e.message}`).join('\n')}
                          >
                            <AlertCircle className="size-3" aria-hidden="true" /> {p.errors.length} erro{p.errors.length === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      {PRIMARY_COLS.map((col) => (
                        <td key={col} className="max-w-[180px] truncate px-3 py-2 text-foreground" title={p.data[col] || ''}>
                          {p.data[col] || <span className="text-muted-foreground">—</span>}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button type="button" className="btn-ghost px-2 py-1" onClick={() => setEditing(p)} aria-label="Editar">
                            Editar
                          </button>
                          <button type="button" className="btn-ghost px-2 py-1 text-error" onClick={() => handleDeleteProduct(p.id)} aria-label="Remover">
                            <Trash2 className="size-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {editing && (
        <ProductEditor
          catalogId={catalogId}
          spec={spec}
          product={editing === 'new' ? null : editing}
          currency={catalog?.currency || 'USD'}
          autoPublish={bcConfigured}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            // 1 clique total: salvar já republica o catálogo no TikTok quando
            // o Business Center está configurado (usa o sync existente; os
            // botões manuais continuam disponíveis para quem preferir).
            const fresh = await mutate()
            const anyValid = (fresh?.products ?? []).some((p) => p.valid)
            if (bcConfigured && anyValid) {
              await handleSyncTiktok()
            } else if (!bcConfigured) {
              toast.info('Produto salvo como rascunho', {
                hint: 'Configure o Business Center no topo para publicar no TikTok.',
              })
            }
          }}
        />
      )}
    </div>
  )
}

// ── Progresso do fluxo confirmado ─────────────────────────────────────────
function CatalogProgress({
  catalog,
  productCount,
  validCount,
  syncing,
}: {
  catalog: AdsCatalog | undefined
  productCount: number
  validCount: number
  syncing: boolean
}) {
  const audit = catalog?.audit
  const hasValidProduct = validCount > 0
  const hasFeed = Boolean(catalog?.feedUrl)
  const hasTikTokCatalog = Boolean(catalog?.tiktokCatalogId)
  const reviewState = !hasTikTokCatalog
    ? 'waiting'
    : !audit || audit.pending > 0
      ? 'active'
      : audit.rejected > 0
        ? 'error'
        : audit.approved > 0
          ? 'done'
          : 'waiting'

  const steps = [
    {
      label: 'Produto válido',
      detail: productCount === 0 ? 'Adicione o primeiro produto' : `${validCount} de ${productCount} válido${validCount === 1 ? '' : 's'}`,
      state: hasValidProduct ? 'done' : productCount > 0 ? 'error' : 'waiting',
    },
    {
      label: 'Feed publicado',
      detail: catalog?.feedPublishedAt ? 'URL estável atualizada' : 'Gerado automaticamente ao publicar',
      state: hasFeed ? 'done' : syncing ? 'active' : 'waiting',
    },
    {
      label: 'Catálogo TikTok',
      detail: hasTikTokCatalog ? `ID ${catalog?.tiktokCatalogId}` : 'Criado no Business Center',
      state: hasTikTokCatalog ? 'done' : syncing ? 'active' : 'waiting',
    },
    {
      label: 'Análise dos produtos',
      detail: audit
        ? `${audit.approved} aprovado(s), ${audit.pending} pendente(s), ${audit.rejected} reprovado(s)`
        : hasTikTokCatalog ? 'Aguardando retorno do TikTok' : 'Começa após a publicação',
      state: reviewState,
    },
  ] as const

  return (
    <section className="rounded-xl border border-border bg-background p-4" aria-labelledby="catalog-progress-title">
      <div className="flex flex-col gap-1">
        <h3 id="catalog-progress-title" className="text-xs font-semibold text-foreground">Progresso da publicação</h3>
        <p className="text-pretty text-[11px] text-muted-foreground">
          Etapas verificadas pela dashboard. Aprovação do produto não significa que uma campanha foi criada.
        </p>
      </div>
      <ol className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step, index) => (
          <li key={step.label} className="flex min-w-0 items-start gap-2 rounded-lg border border-border bg-card p-3">
            <span className={`flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
              step.state === 'done'
                ? 'bg-success/15 text-success'
                : step.state === 'error'
                  ? 'bg-error/15 text-error'
                  : step.state === 'active'
                    ? 'bg-primary/15 text-primary'
                    : 'bg-secondary text-muted-foreground'
            }`}>
              {step.state === 'done' ? <Check className="size-3.5" aria-hidden="true" /> : step.state === 'active' ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : index + 1}
            </span>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold text-foreground">{step.label}</span>
              <span className="block truncate text-[10px] text-muted-foreground" title={step.detail}>{step.detail}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ── Painel de status do catálogo no TikTok ────────────────────────────────
// Mostra somente o que o provider confirma: ID real e contagens agregadas.
function TiktokStatusPanel({
  catalog,
  auditing,
  autoChecking,
  onRefresh,
}: {
  catalog: AdsCatalog
  auditing: boolean
  autoChecking: boolean
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const audit = catalog.audit
  const approved = audit?.approved ?? 0
  const pending = audit?.pending ?? 0
  const rejected = audit?.rejected ?? 0
  const catalogSynced = approved > 0 && pending === 0
  const syncedAt = catalog.syncedAt ? new Date(catalog.syncedAt) : null

  function copyId() {
    if (!catalog.tiktokCatalogId) return
    navigator.clipboard?.writeText(catalog.tiktokCatalogId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${catalogSynced ? 'border-success/30 bg-success/5' : 'border-primary/25 bg-primary/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            {catalogSynced ? (
              <ShieldCheck className="size-4 text-success" aria-hidden="true" />
            ) : (
              <Clock className="size-4 text-primary" aria-hidden="true" />
            )}
            {catalogSynced ? 'Catálogo sincronizado' : 'Catálogo publicado no TikTok'}
          </p>
          {autoChecking && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground" role="status">
              <Loader2 className="size-3 animate-spin" aria-hidden="true" />
              Verificando a análise automaticamente
            </p>
          )}
        </div>
        <button type="button" className="btn-ghost text-xs" onClick={onRefresh} disabled={auditing}>
          {auditing ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <RefreshCw className="size-3.5" aria-hidden="true" />}
          Atualizar status
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="text-muted-foreground">ID do catálogo:</span>
        <code className="rounded bg-background px-2 py-1 text-foreground">{catalog.tiktokCatalogId}</code>
        <button type="button" className="btn-ghost px-1.5 py-1" onClick={copyId} aria-label="Copiar ID do catálogo">
          {copied ? <Check className="size-3 text-success" aria-hidden="true" /> : <Copy className="size-3" aria-hidden="true" />}
        </button>
      </div>

      {/* Auditoria dos produtos */}
      {audit ? (
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-semibold text-success">
            {approved} aprovado{approved === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-warning/15 px-2.5 py-1 text-[11px] font-semibold text-warning">
            {pending} em análise
          </span>
          <span className="inline-flex items-center gap-1 rounded-full bg-error/15 px-2.5 py-1 text-[11px] font-semibold text-error">
            {rejected} reprovado{rejected === 1 ? '' : 's'}
          </span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          Produtos enviados — a auditoria do TikTok pode levar alguns minutos. Clique em “Atualizar status”.
        </p>
      )}

      <p className="text-pretty text-[11px] leading-relaxed text-muted-foreground">
        {catalogSynced
          ? 'O produto está aprovado e sincronizado neste catálogo. A dashboard ainda não cria Product Set, associação com a conta de anúncios ou campanha de catálogo.'
          : rejected > 0
            ? 'Há produtos reprovados. O provider retorna somente as contagens, sem o motivo individual; revise imagem (≥ 500×500), link HTTPS e moeda, depois republique.'
            : 'O TikTok ainda está processando os produtos. Esta tela atualiza as contagens automaticamente enquanto houver itens pendentes.'}
      </p>
      <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-[10px] leading-relaxed text-muted-foreground">
        <strong className="text-foreground">Limite atual da automação:</strong>{' '}
        publicação e análise do catálogo. Nenhum anúncio é criado ou ativado por esta ação.
      </div>
      {syncedAt && (
        <p className="text-[10px] text-muted-foreground">
          Última publicação: {syncedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
          {audit?.at ? ` · Status consultado: ${new Date(audit.at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : ''}
        </p>
      )}
    </div>
  )
}

// Um campo do editor de produto: rótulo pt-BR + chave técnica como dica.
function ProductField({
  field,
  value,
  onChange,
}: {
  field: { key: string; required: boolean; enum: string[] | null }
  value: string
  onChange: (v: string) => void
}) {
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error">*</span>}
        {FIELD_LABELS[field.key] && <span className="text-[10px] text-muted-foreground">{field.key}</span>}
      </span>
      {field.enum ? (
        <select className="input-base" value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">—</option>
          {field.enum.map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      ) : (
        <input
          className={`input-base ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={FIELD_PLACEHOLDERS[field.key]}
        />
      )}
    </label>
  )
}

// ── Editor de um produto (sobreposto) ─────────────────────────────────────
// Renderizado via createPortal no <body>: o editor vivia DENTRO de um card com
// backdrop-filter/transform, que vira "containing block" e prende o
// position:fixed ao card — era o popup quebrado/transparente no iPhone.
// Mobile: bottom sheet (desliza de baixo, largura total, respeitando a
// safe-area). Desktop: modal centrado como antes.

// SKU legível e único o suficiente para um catálogo manual: base36 do
// timestamp + 2 chars aleatórios (ex.: "SKU-MDQ3K2-7F").
function generateSku(): string {
  const rand = Math.random().toString(36).slice(2, 4).toUpperCase()
  return `SKU-${Date.now().toString(36).toUpperCase()}-${rand}`
}

// "9.99", "9,99" ou "1.234,56" → "9.99 BRL" (formato exigido pelo TikTok:
// número + espaço + moeda do catálogo). Valores já formatados passam direto.
function formatPriceForFeed(input: string, currency: string): string {
  const raw = String(input || '').trim()
  if (!raw) return ''
  // Já está no formato final ("9.99 BRL")? Normaliza só a moeda p/ maiúscula.
  const done = raw.match(/^(\d+(?:\.\d{1,2})?)\s+([A-Za-z]{3})$/)
  if (done) return `${done[1]} ${done[2].toUpperCase()}`
  // Aceita vírgula decimal pt-BR e separadores de milhar.
  let n = raw.replace(/\s/g, '')
  if (/,\d{1,2}$/.test(n)) n = n.replace(/\./g, '').replace(',', '.')
  else n = n.replace(/,/g, '')
  if (!/^\d+(?:\.\d{1,2})?$/.test(n)) return raw // deixa a validação apontar
  return `${n} ${currency.toUpperCase()}`
}

// Para editar um produto existente: "9.99 BRL" → "9.99" (o sufixo de moeda é
// re-anexado no salvar; o usuário só vê o número).
function stripCurrency(price: string): string {
  const m = String(price || '').trim().match(/^(\d+(?:\.\d{1,2})?)\s+[A-Za-z]{3}$/)
  return m ? m[1] : String(price || '')
}

function ProductEditor({
  catalogId,
  spec,
  product,
  currency,
  autoPublish,
  onClose,
  onSaved,
}: {
  catalogId: string
  spec: { columns: string[]; required: string[]; enums: Record<string, string[]>; fields: { key: string; required: boolean; enum: string[] | null }[] } | null
  product: AdsCatalogProduct | null
  currency: string
  autoPublish: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  // Menos preenchimento manual: produto novo já nasce com SKU gerado,
  // condição "new" e disponibilidade "in stock" (tudo editável).
  const [form, setForm] = useState<Record<string, string>>((): Record<string, string> => {
    if (product?.data) return { ...product.data, price: stripCurrency(product.data.price || ''), sale_price: stripCurrency(product.data.sale_price || '') }
    return { sku_id: generateSku(), condition: 'new', availability: 'in stock' }
  })
  const [busy, setBusy] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useModalA11y(true, ref, onClose)

  const fields = spec?.fields ?? []
  const required = useMemo(() => new Set(spec?.required ?? []), [spec])

  // Obrigatórios sempre visíveis; os ~36 opcionais ficam recolhidos (o muro de
  // 44 campos era o maior atrito — a maioria dos catálogos usa só os 8 exigidos).
  const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields])
  const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields])

  async function handleSave() {
    setBusy(true)
    try {
      // Preços viram "9.99 BRL" (moeda do catálogo) na hora de salvar — o
      // usuário digita só o número, com ponto ou vírgula.
      const data: Record<string, string> = { ...form }
      if (data.price) data.price = formatPriceForFeed(data.price, currency)
      if (data.sale_price) data.sale_price = formatPriceForFeed(data.sale_price, currency)
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products`, 'POST', { data })
      toast.success(autoPublish ? 'Produto salvo — publicando no TikTok…' : 'Produto salvo')
      onSaved()
    } catch (e) {
      toast.error('Falha ao salvar produto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = [...required].filter((k) => !String(form[k] || '').trim())

  function renderField(f: { key: string; required: boolean; enum: string[] | null }) {
    const common = { value: form[f.key] ?? '', onChange: (v: string) => setForm((s) => ({ ...s, [f.key]: v })) }
    if (f.key === 'price' || f.key === 'sale_price') return <PriceField key={f.key} field={f} currency={currency} {...common} />
    if (f.key === 'image_link' || f.key === 'additional_image_link') return <ImageField key={f.key} field={f} {...common} />
    return <ProductField key={f.key} field={f} {...common} />
  }

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center sm:overflow-y-auto sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Editar produto" tabIndex={-1} className="w-full outline-none sm:max-w-lg">
        {/* Mobile: bottom sheet colado na base com cantos superiores redondos e
            safe-area; desktop: card centrado */}
        <div className="anim-pop-in flex max-h-[88dvh] flex-col gap-4 overflow-hidden rounded-t-2xl border border-border bg-card p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:max-h-[85vh] sm:rounded-2xl sm:pb-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {product ? 'Editar produto' : 'Novo produto'}
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            {requiredFields.map(renderField)}

            {optionalFields.length > 0 && (
              <button
                type="button"
                className="btn-ghost w-fit text-xs"
                onClick={() => setShowOptional((v) => !v)}
                aria-expanded={showOptional}
              >
                {showOptional ? <ChevronLeft className="size-3.5 rotate-90" aria-hidden="true" /> : <Plus className="size-3.5" aria-hidden="true" />}
                {showOptional ? 'Ocultar campos opcionais' : `Mostrar campos opcionais (${optionalFields.length})`}
              </button>
            )}
            {showOptional && optionalFields.map(renderField)}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              {missingRequired.length > 0
                ? `Faltam obrigatórios: ${missingRequired.map((k) => FIELD_LABELS[k] || k).join(', ')}`
                : autoPublish
                  ? 'Ao salvar, o catálogo é republicado no TikTok'
                  : 'Todos os campos obrigatórios preenchidos'}
            </p>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSave} disabled={busy || missingRequired.length > 0}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : autoPublish ? <Rocket className="size-3.5" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              {autoPublish ? 'Salvar e publicar' : 'Salvar'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── Campo de preço simplificado ────────────────────────────────────────────
// O usuário digita só o número (9.99 ou 9,99); a moeda do catálogo aparece
// como sufixo fixo e é anexada automaticamente no salvar.
function PriceField({
  field,
  currency,
  value,
  onChange,
}: {
  field: { key: string; required: boolean }
  currency: string
  value: string
  onChange: (v: string) => void
}) {
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error">*</span>}
        <span className="text-[10px] text-muted-foreground">{field.key}</span>
      </span>
      <span className="relative flex items-center">
        <input
          className={`input-base w-full pr-14 ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ex.: 9.99"
          inputMode="decimal"
        />
        <span className="pointer-events-none absolute right-3 text-[11px] font-semibold text-muted-foreground">
          {currency.toUpperCase()}
        </span>
      </span>
    </label>
  )
}

// ── Campo de imagem com upload ─────────────────────────────────────────────
// Botão "Enviar foto" sobe a imagem para o Vercel Blob (rota /api/ads/upload
// já existente) e preenche a URL sozinho; colar URL continua funcionando.
// Preview aparece quando a URL é válida.
function ImageField({
  field,
  value,
  onChange,
}: {
  field: { key: string; required: boolean }
  value: string
  onChange: (v: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const label = FIELD_LABELS[field.key] || field.key
  const isMissing = field.required && !String(value).trim()
  const showPreview = /^https?:\/\/.+/i.test(String(value).trim())

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      const res = await fetch(
        `/api/ads/upload?kind=image&filename=${encodeURIComponent(file.name)}`,
        { method: 'POST', body: file, credentials: 'include' },
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
      onChange(data.url)
      toast.success('Foto enviada — URL preenchida')
    } catch (e) {
      toast.error('Falha ao enviar a foto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="flex items-baseline gap-1.5">
        <span className="font-medium text-foreground">{label}</span>
        {field.required && <span className="text-error">*</span>}
        <span className="text-[10px] text-muted-foreground">{field.key}</span>
      </span>
      <div className="flex items-center gap-2">
        {/* Preview compacto (o TikTok exige ≥ 500×500 na origem) */}
        {showPreview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value || "/placeholder.svg"}
            alt="Preview do produto"
            className="size-10 shrink-0 rounded-lg border border-border object-cover"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
        )}
        <input
          className={`input-base min-w-0 flex-1 ${isMissing ? 'border-error/50' : ''}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={FIELD_PLACEHOLDERS[field.key] || 'https://… (≥ 500×500)'}
        />
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) handleUpload(f)
          }}
        />
        <button
          type="button"
          className="btn-ghost shrink-0 text-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <ImageIcon className="size-3.5" aria-hidden="true" />}
          Enviar foto
        </button>
      </div>
    </div>
  )
}
