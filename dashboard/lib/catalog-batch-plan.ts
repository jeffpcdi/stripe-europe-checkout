export type CatalogBatchPlanCatalog = {
  key: string
  name: string
  currency: string
  country: string
  catalogType: string
  products: { data: Record<string, string> }[]
  campaigns: Record<string, unknown>[]
}

export type CatalogBatchPlan = {
  catalogs: CatalogBatchPlanCatalog[]
  rows: number
  message: string
}

export type CatalogBatchPlanOptions = {
  requireCampaignPixel?: boolean
  // Pixel aplicado automaticamente a toda campanha sem a coluna pixel_id.
  // Vem da lista autenticada de Pixels da conta de anúncio (auto-seleção).
  defaultPixelId?: string
  // Evento aplicado quando a coluna "evento" está vazia (padrão ON_WEB_ORDER).
  defaultPixelEvent?: string
  // Converte códigos do Events Manager (ex.: D9F2J3JC77U5KEVKQB80) colados na
  // coluna pixel_id para o ID numérico exigido pela API. Chaves em MAIÚSCULAS.
  pixelCodeMap?: Record<string, string>
}

const HEADERS: Record<string, string[]> = {
  catalog: ['catalogo', 'catálogo', 'catalog', 'catalog_name', 'nome_catalogo'],
  sku: ['sku', 'sku_id', 'id', 'id_produto'],
  title: ['titulo', 'título', 'title', 'nome', 'nome_produto'],
  description: ['descricao', 'descrição', 'description'],
  price: ['preco', 'preço', 'price', 'valor'],
  brand: ['marca', 'brand', 'fabricante', 'manufacturer'],
  link: ['link', 'url_produto', 'product_link', 'url'],
  image: ['imagem', 'image', 'image_link', 'link_imagem', 'url_imagem'],
  campaign: ['campanha', 'campaign', 'campaign_name', 'nome_campanha'],
  budget: ['orcamento', 'orçamento', 'budget', 'daily_budget', 'orcamento_diario'],
  pixelId: ['pixel_id', 'pixel', 'id_pixel', 'pixel_tiktok', 'tiktok_pixel_id'],
  pixelEvent: ['evento', 'evento_pixel', 'pixel_event', 'optimization_event', 'evento_otimizacao'],
  video: ['video', 'video_id', 'criativo', 'video_tiktok', 'id_video'],
  cover: ['capa', 'cover', 'cover_id', 'image_id', 'thumb', 'capa_id'],
}

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

export function parseDelimited(raw: string) {
  const input = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const firstLine = input.split('\n').find((line) => line.trim()) || ''
  const delimiter = firstLine.includes('\t') ? '\t' : firstLine.includes(';') ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') quoted = false
      else field += char
      continue
    }
    if (char === '"') quoted = true
    else if (char === delimiter) {
      row.push(field.trim())
      field = ''
    } else if (char === '\n') {
      row.push(field.trim())
      if (row.some((value) => value)) rows.push(row)
      row = []
      field = ''
    } else field += char
  }
  row.push(field.trim())
  if (row.some((value) => value)) rows.push(row)
  return rows
}

function catalogKey(value: string, fallback: string) {
  const out = normalizeHeader(value).replace(/[^a-z0-9_]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return out || fallback
}

function catalogIdentity(value: string) {
  return value.normalize('NFC').trim()
}

function productPrice(value: string, currency: string) {
  const raw = value.trim()
  if (!raw) return ''
  if (/\b[A-Za-z]{3}\b/.test(raw)) return raw.replace(',', '.')
  const withoutSymbol = raw.replace(/^R\$\s*/i, '')
  const number = withoutSymbol.includes(',')
    ? withoutSymbol.replace(/\./g, '').replace(',', '.')
    : withoutSymbol
  return `${number} ${currency}`
}

function campaignBudget(value: string) {
  const raw = value.trim()
  if (!raw) return undefined
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw
  return Number(normalized) || undefined
}

export function buildCatalogBatchPlan(raw: string, currency: string, options: CatalogBatchPlanOptions = {}): CatalogBatchPlan {
  const pixelCodeMap = options.pixelCodeMap || {}
  // Aceita ID numérico direto ou código do Events Manager resolvível pela conta.
  const resolvePixel = (value: string) => {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''
    if (/^\d{6,30}$/.test(trimmed)) return trimmed
    return pixelCodeMap[trimmed.toUpperCase()] || trimmed
  }
  const defaultPixelId = /^\d{6,30}$/.test(resolvePixel(String(options.defaultPixelId || '')))
    ? resolvePixel(String(options.defaultPixelId || ''))
    : ''
  const defaultPixelEvent = String(options.defaultPixelEvent || '').trim().toUpperCase() || 'ON_WEB_ORDER'
  const rows = parseDelimited(raw)
  if (rows.length < 2) {
    return { catalogs: [], rows: 0, message: 'Cole o cabeçalho e pelo menos uma linha de produto.' }
  }

  const header = rows[0].map(normalizeHeader)
  const indexFor = (field: keyof typeof HEADERS) => header.findIndex((value) => HEADERS[field].map(normalizeHeader).includes(value))
  const idx = {
    catalog: indexFor('catalog'), sku: indexFor('sku'), title: indexFor('title'), description: indexFor('description'),
    price: indexFor('price'), brand: indexFor('brand'), link: indexFor('link'), image: indexFor('image'), campaign: indexFor('campaign'), budget: indexFor('budget'),
    pixelId: indexFor('pixelId'), pixelEvent: indexFor('pixelEvent'), video: indexFor('video'), cover: indexFor('cover'),
  }
  if (idx.brand < 0) {
    return {
      catalogs: [], rows: Math.max(0, rows.length - 1),
      message: 'Inclua a coluna “marca” (ou “brand”). O TikTok exige a marca real de cada produto e a dashboard não inventa esse valor.',
    }
  }

  const valueAt = (row: string[], index: number) => index >= 0 ? String(row[index] || '').trim() : ''
  const byKey = new Map<string, CatalogBatchPlanCatalog>()
  const catalogOrigins = new Map<string, { identity: string; name: string; line: number }>()
  const collisionSignatures = new Set<string>()
  const catalogCollisions: { key: string; first: { name: string; line: number }; next: { name: string; line: number } }[] = []
  const campaignKeys = new Set<string>()
  const missingBrandRows: number[] = []
  const missingCampaignPixelRows: number[] = []
  const invalidCampaignPixelRows: number[] = []

  rows.slice(1).forEach((row, position) => {
    const line = position + 2
    const catalogName = valueAt(row, idx.catalog) || `Catálogo ${position + 1}`
    const key = catalogKey(catalogName, `catalogo-${position + 1}`)
    const brand = valueAt(row, idx.brand)
    if (!brand) missingBrandRows.push(line)

    const identity = catalogIdentity(catalogName)
    const origin = catalogOrigins.get(key)
    if (origin && origin.identity !== identity) {
      const signature = `${key}\u0000${origin.identity}\u0000${identity}`
      if (!collisionSignatures.has(signature)) {
        collisionSignatures.add(signature)
        catalogCollisions.push({
          key,
          first: { name: origin.name, line: origin.line },
          next: { name: catalogName, line },
        })
      }
      return
    }

    let catalog = byKey.get(key)
    if (!catalog) {
      catalogOrigins.set(key, { identity, name: catalogName, line })
      catalog = { key, name: catalogName, currency, country: 'BR', catalogType: 'ECOM', products: [], campaigns: [] }
      byKey.set(key, catalog)
    }

    const title = valueAt(row, idx.title)
    catalog.products.push({
      data: {
        sku_id: valueAt(row, idx.sku),
        title,
        description: valueAt(row, idx.description) || title,
        availability: 'in stock',
        condition: 'new',
        price: productPrice(valueAt(row, idx.price), currency),
        brand,
        link: valueAt(row, idx.link),
        image_link: valueAt(row, idx.image),
      },
    })

    const campaignName = valueAt(row, idx.campaign)
    const campaignKey = `${key}:${campaignName}`
    if (campaignName && !campaignKeys.has(campaignKey)) {
      campaignKeys.add(campaignKey)
      // Pixel automático: linha sem pixel_id herda o Pixel padrão da conta,
      // eliminando a digitação manual em cada linha do lote. Códigos do
      // Events Manager são convertidos para o ID numérico via pixelCodeMap.
      const pixelId = resolvePixel(valueAt(row, idx.pixelId)) || defaultPixelId
      if (!pixelId) missingCampaignPixelRows.push(line)
      else if (!/^\d{6,30}$/.test(pixelId)) invalidCampaignPixelRows.push(line)
      catalog.campaigns.push({
        name: campaignName,
        budgetAmount: campaignBudget(valueAt(row, idx.budget)),
        budgetType: 'daily',
        productScope: 'all',
        pixelId,
        pixelEvent: valueAt(row, idx.pixelEvent).toUpperCase() || defaultPixelEvent,
        // Criativo de VÍDEO por campanha (o gestor escolheu 1 vídeo por campanha).
        videoId: valueAt(row, idx.video),
        coverImageId: valueAt(row, idx.cover),
      })
    }
  })

  const messages: string[] = []
  if (missingBrandRows.length) {
    messages.push(`Preencha a marca real nas linhas ${missingBrandRows.slice(0, 6).join(', ')}${missingBrandRows.length > 6 ? '…' : ''}. O TikTok não aceita produtos sem brand.`)
  }
  if (catalogCollisions.length) {
    const examples = catalogCollisions.slice(0, 4).map((collision) =>
      `“${collision.first.name}” (linha ${collision.first.line}) e “${collision.next.name}” (linha ${collision.next.line}) usam a chave “${collision.key}”`,
    )
    messages.push(`Nomes de catálogo diferentes não podem ser agrupados: ${examples.join('; ')}${catalogCollisions.length > 4 ? '; …' : ''}. Renomeie um deles.`)
  }
  if (options.requireCampaignPixel && missingCampaignPixelRows.length) {
    messages.push(`Informe o Pixel ID do TikTok nas campanhas das linhas ${missingCampaignPixelRows.slice(0, 6).join(', ')}${missingCampaignPixelRows.length > 6 ? '…' : ''}. Selecione um Pixel padrão acima ou preencha a coluna “pixel_id” com 6 a 30 dígitos.`)
  }
  if (options.requireCampaignPixel && invalidCampaignPixelRows.length) {
    messages.push(`Corrija o Pixel nas linhas ${invalidCampaignPixelRows.slice(0, 6).join(', ')}${invalidCampaignPixelRows.length > 6 ? '…' : ''}: use o ID numérico (6 a 30 dígitos) ou um código do Events Manager que pertença a esta conta de anúncio.`)
  }

  // Product Link: a URL base de cada campanha vem do LINK do 1º produto válido do
  // catálogo. Não é URL global digitada — é o próprio Link do catálogo; e no
  // anúncio product_info_enabled=CATALOG faz CADA produto usar o SEU link.
  for (const catalog of byKey.values()) {
    const firstLink = (catalog.products.find((product) => (product.data.link || '').trim())?.data.link || '').trim()
    if (!firstLink) continue
    for (const campaign of catalog.campaigns) {
      ;(campaign as Record<string, unknown>).productLink = firstLink
    }
  }

  return {
    catalogs: [...byKey.values()],
    rows: Math.max(0, rows.length - 1),
    message: messages.join(' '),
  }
}
