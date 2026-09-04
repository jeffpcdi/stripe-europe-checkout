// Parser, validador e gerador do feed de catálogo do TikTok.
// Espelha a spec do template oficial (tiktok_catalogues_template.csv): 44
// colunas, ordem fixa, com regras de obrigatoriedade/enum por campo.

// Ordem canônica das colunas — igual ao cabeçalho do template do TikTok.
const COLUMNS = [
  'sku_id', 'title', 'description', 'availability', 'condition', 'price', 'link',
  'image_link', 'brand', 'video_link', 'additional_image_link', 'age_group', 'color',
  'gender', 'item_group_id', 'google_product_category', 'material', 'pattern',
  'product_type', 'sale_price', 'sale_price_effective_date', 'shipping',
  'shipping_weight', 'gtin', 'mpn', 'size', 'tax', 'ios_url', 'ios_app_store_id',
  'ios_app_name', 'iPhone_url', 'iPhone_app_store_id', 'iPhone_app_name', 'iPad_url',
  'iPad_app_store_id', 'iPad_app_name', 'android_url', 'android_package',
  'android_app_name', 'custom_label_0', 'custom_label_1', 'custom_label_2',
  'custom_label_3', 'custom_label_4'
];

// O template oficial trata `brand` como o 9º campo obrigatório. Não inferimos
// marca a partir de título, domínio ou nome do catálogo: isso criaria dados
// comerciais incorretos e o TikTok pode rejeitar o produto na auditoria.
const REQUIRED = ['sku_id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand'];

// Enums aceitos pelo TikTok (case-insensitive na validação).
const ENUMS = {
  availability: ['in stock', 'available for order', 'preorder', 'out of stock', 'discontinued'],
  condition: ['new', 'refurbished', 'used'],
  age_group: ['newborn', 'infant', 'toddler', 'kids', 'adult'],
  gender: ['male', 'female', 'unisex']
};

// Metadados para a UI: rótulo amigável e se é obrigatório.
const FIELD_META = COLUMNS.map((key) => ({
  key,
  label: key,
  required: REQUIRED.includes(key),
  enum: ENUMS[key] || null
}));

// ── CSV parser (RFC 4180) ────────────────────────────────────────────────
// Suporta aspas, vírgulas dentro de aspas, aspas escapadas ("") e quebras de
// linha dentro de campos. Devolve matriz de linhas (cada linha = array).
function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const str = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (inQuotes) {
      if (ch === '"') {
        if (str[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  // último campo/linha (sem newline final)
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Uma linha é "de instrução" (linhas 4 & 5 do template) quando começa com as
// dicas de preenchimento, não com dados reais. Detecta pelo texto conhecido.
function isInstructionRow(cells) {
  const first = String(cells[0] || '').trim();
  if (!first) return false;
  return /^Required\.|^Remove rows|^Optional\./i.test(first);
}

// Converte o CSV do template em array de objetos {campo: valor}. Ignora o
// cabeçalho, linhas totalmente vazias e as linhas de instrução do template.
function parseCatalogCsv(text) {
  const rows = parseCsvRows(text);
  if (!rows.length) return { header: [], products: [] };
  const header = rows[0].map((h) => String(h || '').trim());
  const products = [];
  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i];
    const allEmpty = cells.every((c) => String(c || '').trim() === '');
    if (allEmpty) continue;
    if (isInstructionRow(cells)) continue;
    const data = {};
    header.forEach((key, idx) => {
      if (!key) return;
      const val = cells[idx] != null ? String(cells[idx]).trim() : '';
      if (val !== '') data[key] = val;
    });
    if (Object.keys(data).length === 0) continue;
    products.push({ data });
  }
  return { header, products };
}

// ── Validação por produto ─────────────────────────────────────────────────
// Preço deve ser "número ESPAÇO moeda", ex.: "9.99 USD". A moeda precisa bater
// com a moeda padrão do catálogo (regra do TikTok).
function validatePriceField(value, currency) {
  const m = String(value || '').trim().match(/^(\d+(?:\.\d{1,2})?)\s+([A-Za-z]{3})$/);
  if (!m) return `formato inválido (use "9.99 ${currency || 'USD'}")`;
  if (currency && m[2].toUpperCase() !== String(currency).toUpperCase()) {
    return `moeda deve ser ${String(currency).toUpperCase()}`;
  }
  return null;
}

function isHttpUrl(value) {
  return /^https?:\/\/.+/i.test(String(value || '').trim());
}

// Valida um produto contra a spec. Retorna { valid, errors: [{field, message}] }.
function validateProduct(data, catalog) {
  const errors = [];
  const currency = (catalog && catalog.currency) || 'USD';
  const d = data || {};

  for (const field of REQUIRED) {
    if (!String(d[field] || '').trim()) errors.push({ field, message: 'obrigatório' });
  }

  if (String(d.sku_id || '').length > 100) errors.push({ field: 'sku_id', message: 'máx. 100 caracteres' });
  if (String(d.title || '').length > 500) errors.push({ field: 'title', message: 'máx. 500 caracteres' });
  if (String(d.description || '').length > 10000) errors.push({ field: 'description', message: 'máx. 10.000 caracteres' });

  if (d.availability && !ENUMS.availability.includes(String(d.availability).toLowerCase())) {
    errors.push({ field: 'availability', message: `valor aceito: ${ENUMS.availability.join(', ')}` });
  }
  if (d.condition && !ENUMS.condition.includes(String(d.condition).toLowerCase())) {
    errors.push({ field: 'condition', message: `valor aceito: ${ENUMS.condition.join(', ')}` });
  }
  if (d.age_group && !ENUMS.age_group.includes(String(d.age_group).toLowerCase())) {
    errors.push({ field: 'age_group', message: `valor aceito: ${ENUMS.age_group.join(', ')}` });
  }
  if (d.gender && !ENUMS.gender.includes(String(d.gender).toLowerCase())) {
    errors.push({ field: 'gender', message: `valor aceito: ${ENUMS.gender.join(', ')}` });
  }

  if (d.price) {
    const priceErr = validatePriceField(d.price, currency);
    if (priceErr) errors.push({ field: 'price', message: priceErr });
  }
  if (d.sale_price) {
    const saleErr = validatePriceField(d.sale_price, currency);
    if (saleErr) errors.push({ field: 'sale_price', message: saleErr });
  }

  if (d.link && !isHttpUrl(d.link)) errors.push({ field: 'link', message: 'deve começar com http:// ou https://' });
  if (d.image_link && !isHttpUrl(d.image_link)) errors.push({ field: 'image_link', message: 'deve começar com http:// ou https://' });
  if (d.video_link && !isHttpUrl(d.video_link)) errors.push({ field: 'video_link', message: 'deve começar com http:// ou https://' });

  return { valid: errors.length === 0, errors };
}

// Catalog Carousel usa `item_group_id` como o identificador do card que leva
// ao Link individual do produto. Para itens simples (um SKU por produto), o
// próprio sku_id é um identificador estável e evita pedir mais um campo ao
// usuário. Variantes continuam podendo informar um item_group_id compartilhado.
function withCatalogCarouselId(data) {
  const source = data || {};
  const out = Object.assign({}, source);
  if (!String(out.item_group_id || '').trim() && String(out.sku_id || '').trim()) {
    out.item_group_id = String(out.sku_id).trim();
  }
  return out;
}

// ── Gerador de CSV pronto pro TikTok ────────────────────────────────────────
function escapeCsvValue(value) {
  const s = value == null ? '' : String(value);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// Monta o CSV final: cabeçalho canônico + uma linha por produto, na ordem das
// colunas. Sem as linhas de instrução (o TikTok as rejeita).
function buildCatalogCsv(products) {
  const lines = [COLUMNS.join(',')];
  for (const product of products || []) {
    const d = withCatalogCarouselId((product && product.data) || product || {});
    const row = COLUMNS.map((col) => escapeCsvValue(d[col]));
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

function escapeXmlValue(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Feed XML complementar (RSS/Google Merchant compatível). A publicação
// automática no conector continua usando o CSV canônico do TikTok; este XML
// fica disponível para integrações e para o "Sync Mágico" solicitado.
function buildCatalogXml(products, catalog) {
  const title = escapeXmlValue(catalog && catalog.name || 'Catálogo ROI-NADOS');
  const items = (products || []).map((product) => {
    const d = withCatalogCarouselId(product && product.data || product || {});
    const fields = {
      id: d.sku_id,
      title: d.title,
      description: d.description,
      availability: d.availability,
      condition: d.condition,
      price: d.price,
      link: d.link,
      image_link: d.image_link,
      brand: d.brand,
      sale_price: d.sale_price,
      item_group_id: d.item_group_id,
    };
    const body = Object.entries(fields).filter(([, value]) => value != null && String(value) !== '')
      .map(([key, value]) => '      <g:' + key + '>' + escapeXmlValue(value) + '</g:' + key + '>').join('\n');
    return '    <item>\n' + body + '\n    </item>';
  }).join('\n');
  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n'
    + '  <channel>\n    <title>' + title + '</title>\n'
    + '    <link>https://roi-nados.app</link>\n'
    + '    <description>Feed de produtos sincronizado pelo ROI-NADOS</description>\n'
    + items + '\n  </channel>\n</rss>\n';
}

module.exports = {
  COLUMNS,
  REQUIRED,
  ENUMS,
  FIELD_META,
  parseCsvRows,
  parseCatalogCsv,
  validateProduct,
  validatePriceField,
  withCatalogCarouselId,
  buildCatalogCsv,
  buildCatalogXml
};
