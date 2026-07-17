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

import { useMemo, useRef, useState } from 'react'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download, Rocket,
  Copy, Check, AlertCircle, ChevronLeft, ExternalLink, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil,
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
  const [importing, setImporting] = useState(false)
  const [copied, setCopied] = useState(false)

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
          hint: res.audit && res.audit.pending > 0 ? 'Os produtos entram em análise do TikTok — acompanhe o status abaixo.' : undefined,
        })
      }
      mutate()
    } catch (e) {
      toast.error('Falha ao publicar no TikTok', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSyncing(false)
    }
  }

  async function handleRefreshAudit() {
    setAuditing(true)
    try {
      const res = await fetch(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/audit`, { credentials: 'include' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `Erro ${res.status}`)
      }
      mutate()
    } catch (e) {
      toast.error('Falha ao atualizar status', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setAuditing(false)
    }
  }

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
          {catalog?.tiktokCatalogId && <TiktokStatusPanel catalog={catalog} auditing={auditing} onRefresh={handleRefreshAudit} />}

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
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}

// ── Painel de status do catálogo no TikTok ────────────────────────────────
// Mostra que o catálogo já vive no TikTok (id real + auditoria dos produtos) e
// se está pronto para uma campanha de vendas (DPA).
function TiktokStatusPanel({
  catalog,
  auditing,
  onRefresh,
}: {
  catalog: AdsCatalog
  auditing: boolean
  onRefresh: () => void
}) {
  const [copied, setCopied] = useState(false)
  const audit = catalog.audit
  const approved = audit?.approved ?? 0
  const pending = audit?.pending ?? 0
  const rejected = audit?.rejected ?? 0
  // "Pronto para campanha" = há produtos aprovados e nada em análise pendente.
  const ready = approved > 0 && pending === 0
  const syncedAt = catalog.syncedAt ? new Date(catalog.syncedAt) : null

  function copyId() {
    if (!catalog.tiktokCatalogId) return
    navigator.clipboard?.writeText(catalog.tiktokCatalogId).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className={`flex flex-col gap-3 rounded-xl border p-4 ${ready ? 'border-success/30 bg-success/5' : 'border-primary/25 bg-primary/5'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          {ready ? (
            <ShieldCheck className="size-4 text-success" aria-hidden="true" />
          ) : (
            <Clock className="size-4 text-primary" aria-hidden="true" />
          )}
          {ready ? 'Publicado no TikTok — pronto para campanha' : 'Publicado no TikTok'}
        </p>
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
        {ready
          ? 'Crie uma campanha de Product Sales (DPA) no TikTok Ads Manager e selecione este catálogo. As edições de produtos aqui, ao republicar, atualizam o mesmo catálogo.'
          : rejected > 0
            ? 'Alguns produtos foram reprovados pelo TikTok — verifique imagens (≥ 500×500), links https válidos e a moeda do preço, corrija na tabela e republique.'
            : 'Assim que os produtos forem aprovados, o catálogo fica disponível na criação de campanhas de Product Sales (DPA).'}
      </p>
      {syncedAt && (
        <p className="text-[10px] text-muted-foreground">
          Última publicação: {syncedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
        </p>
      )}
      <a
        className="btn-ghost w-fit text-xs"
        href="https://ads.tiktok.com/i18n/creation/campaign"
        target="_blank"
        rel="noreferrer"
      >
        <ExternalLink className="size-3.5" aria-hidden="true" />
        Abrir criação de campanha
      </a>
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
function ProductEditor({
  catalogId,
  spec,
  product,
  onClose,
  onSaved,
}: {
  catalogId: string
  spec: { columns: string[]; required: string[]; enums: Record<string, string[]>; fields: { key: string; required: boolean; enum: string[] | null }[] } | null
  product: AdsCatalogProduct | null
  onClose: () => void
  onSaved: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [form, setForm] = useState<Record<string, string>>(product?.data ?? {})
  const [busy, setBusy] = useState(false)
  const [showOptional, setShowOptional] = useState(false)
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
      await apiSend(`/api/ads/catalogs/${encodeURIComponent(catalogId)}/products`, 'POST', { data: form })
      toast.success('Produto salvo')
      onSaved()
    } catch (e) {
      toast.error('Falha ao salvar produto', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setBusy(false)
    }
  }

  const missingRequired = [...required].filter((k) => !String(form[k] || '').trim())

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div ref={ref} role="dialog" aria-modal="true" aria-label="Editar produto" tabIndex={-1} className="w-full max-w-lg outline-none">
        <div className="anim-pop-in flex max-h-[85vh] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-foreground">
              {product ? 'Editar produto' : 'Novo produto'}
            </h3>
            <button type="button" className="btn-ghost px-2 py-1" onClick={onClose} aria-label="Fechar">
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-col gap-3 overflow-y-auto pr-1">
            {requiredFields.map((f) => (
              <ProductField key={f.key} field={f} value={form[f.key] ?? ''} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
            ))}

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
            {showOptional && optionalFields.map((f) => (
              <ProductField key={f.key} field={f} value={form[f.key] ?? ''} onChange={(v) => setForm((s) => ({ ...s, [f.key]: v }))} />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="text-[11px] text-muted-foreground">
              {missingRequired.length > 0
                ? `Faltam obrigatórios: ${missingRequired.join(', ')}`
                : 'Todos os campos obrigatórios preenchidos'}
            </p>
            <button type="button" className="btn-primary shrink-0 text-xs" onClick={handleSave} disabled={busy || missingRequired.length > 0}>
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Check className="size-3.5" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
