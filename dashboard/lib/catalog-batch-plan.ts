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
  budgetType: ['tipo_orcamento', 'tipo_de_orcamento', 'budget_type', 'budget_mode'],
  pixelId: ['pixel_id', 'pixel', 'id_pixel', 'pixel_tiktok', 'tiktok_pixel_id'],
  pixelEvent: ['evento', 'evento_pixel', 'pixel_event', 'optimization_event', 'evento_otimizacao'],
  country: ['pais', 'país', 'country', 'country_code'],
  period: ['periodo', 'período', 'data_fim', 'end_date', 'schedule_end_date'],
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

function campaignBudgetType(value: string): 'daily' | 'lifetime' {
  const normalized = normalizeHeader(value)
  return ['lifetime', 'total', 'orcamento_total', 'orçamento_total'].includes(normalized) ? 'lifetime' : 'daily'
}

type CampaignConfig = {
  budgetAmount: number | undefined
  budgetType: 'daily' | 'lifetime'
  pixelId: string
  pixelEvent: string
  country: string
  endDate: string
}

const CAMPAIGN_CONFIG_LABELS: Record<keyof CampaignConfig, string> = {
  budgetAmount: 'orçamento',
  budgetType: 'tipo de orçamento',
  pixelId: 'Pixel ID',
  pixelEvent: 'evento',
  country: 'país',
  endDate: 'período',
}

function conflictingCampaignFields(first: CampaignConfig, next: CampaignConfig) {
  return (Object.keys(CAMPAIGN_CONFIG_LABELS) as (keyof CampaignConfig)[])
    .filter((field) => first[field] !== next[field])
    .map((field) => CAMPAIGN_CONFIG_LABELS[field])
}

export function buildCatalogBatchPlan(raw: string, currency: string, options: CatalogBatchPlanOptions = {}): CatalogBatchPlan {
  const rows = parseDelimited(raw)
  if (rows.length < 2) {
    return { catalogs: [], rows: 0, message: 'Cole o cabeçalho e pelo menos uma linha de produto.' }
  }

  const header = rows[0].map(normalizeHeader)
  const indexFor = (field: keyof typeof HEADERS) => header.findIndex((value) => HEADERS[field].map(normalizeHeader).includes(value))
  const idx = {
    catalog: indexFor('catalog'), sku: indexFor('sku'), title: indexFor('title'), description: indexFor('description'),
    price: indexFor('price'), brand: indexFor('brand'), link: indexFor('link'), image: indexFor('image'), campaign: indexFor('campaign'), budget: indexFor('budget'),
    pixelId: indexFor('pixelId'), pixelEvent: indexFor('pixelEvent'), budgetType: indexFor('budgetType'),
    country: indexFor('country'), period: indexFor('period'),
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
  const campaignOrigins = new Map<string, { line: number; name: string; catalogName: string; config: CampaignConfig }>()
  const campaignConflicts: { first: { line: number }; next: { line: number }; name: string; catalogName: string; fields: string[] }[] = []
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
    if (campaignName) {
      const pixelId = valueAt(row, idx.pixelId)
      if (!pixelId) missingCampaignPixelRows.push(line)
      else if (!/^\d{6,30}$/.test(pixelId)) invalidCampaignPixelRows.push(line)
      const campaignConfig: CampaignConfig = {
        budgetAmount: campaignBudget(valueAt(row, idx.budget)),
        budgetType: campaignBudgetType(valueAt(row, idx.budgetType)),
        pixelId,
        pixelEvent: valueAt(row, idx.pixelEvent).toUpperCase() || 'ON_WEB_ORDER',
        country: valueAt(row, idx.country).toUpperCase() || catalog.country,
        endDate: valueAt(row, idx.period),
      }
      const firstCampaign = campaignOrigins.get(campaignKey)
      if (firstCampaign) {
        const fields = conflictingCampaignFields(firstCampaign.config, campaignConfig)
        if (fields.length) {
          campaignConflicts.push({
            first: { line: firstCampaign.line }, next: { line }, name: campaignName,
            catalogName, fields,
          })
        }
        return
      }
      campaignOrigins.set(campaignKey, { line, name: campaignName, catalogName, config: campaignConfig })
      catalog.campaigns.push({
        name: campaignName,
        budgetAmount: campaignConfig.budgetAmount,
        budgetType: campaignConfig.budgetType,
        productScope: 'all',
        pixelId: campaignConfig.pixelId,
        pixelEvent: campaignConfig.pixelEvent,
        country: campaignConfig.country,
        ...(campaignConfig.endDate ? { endDate: campaignConfig.endDate } : {}),
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
  if (campaignConflicts.length) {
    const examples = campaignConflicts.slice(0, 4).map((conflict) =>
      `“${conflict.name}” do catálogo “${conflict.catalogName}” nas linhas ${conflict.first.line} e ${conflict.next.line} (${conflict.fields.join(', ')})`,
    )
    messages.push(`A mesma campanha não pode ter configurações diferentes: ${examples.join('; ')}${campaignConflicts.length > 4 ? '; …' : ''}. Mantenha a mesma configuração em todas as linhas ou use outro nome de campanha.`)
  }
  if (options.requireCampaignPixel && missingCampaignPixelRows.length) {
    messages.push(`Informe o Pixel ID do TikTok nas campanhas das linhas ${missingCampaignPixelRows.slice(0, 6).join(', ')}${missingCampaignPixelRows.length > 6 ? '…' : ''}. Use a coluna “pixel_id” com 6 a 30 dígitos.`)
  }
  if (options.requireCampaignPixel && invalidCampaignPixelRows.length) {
    messages.push(`Corrija o Pixel ID nas linhas ${invalidCampaignPixelRows.slice(0, 6).join(', ')}${invalidCampaignPixelRows.length > 6 ? '…' : ''}: ele deve conter somente 6 a 30 dígitos.`)
  }

  return {
    catalogs: [...byKey.values()],
    rows: Math.max(0, rows.length - 1),
    message: messages.join(' '),
  }
}
