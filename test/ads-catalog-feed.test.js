'use strict';
/*
 * ads-catalog-feed — parse/validação/geração do feed de catálogo do TikTok.
 * O feed vai direto pro Catalog Manager do TikTok: um parse errado ou uma
 * validação frouxa fazem o TikTok rejeitar o feed inteiro. Cada caso aqui
 * reflete uma regra real do template oficial.
 */
const assert = require('assert');
const feed = require('../ads-catalog-feed');

let n = 0;
function ok(cond, label) {
  assert.ok(cond, label);
  n++;
  console.log('  ✓ ' + label);
}
function eq(actual, expected, label) {
  assert.strictEqual(actual, expected, label + ' → esperado ' + expected + ', veio ' + actual);
  n++;
  console.log('  ✓ ' + label);
}

console.log('parseCsvRows — RFC 4180');
{
  const rows = feed.parseCsvRows('a,b,c\n1,2,3');
  eq(rows.length, 2, 'duas linhas');
  eq(rows[1][2], '3', 'célula simples');

  const quoted = feed.parseCsvRows('a,b\n"x,y","z""w"');
  eq(quoted[1][0], 'x,y', 'vírgula dentro de aspas preservada');
  eq(quoted[1][1], 'z"w', 'aspas escapadas ("") viram uma aspa');

  const multiline = feed.parseCsvRows('a,b\n"linha1\nlinha2",fim');
  eq(multiline[1][0], 'linha1\nlinha2', 'quebra de linha dentro de aspas');
}

console.log('parseCatalogCsv — ignora cabeçalho, vazios e instruções');
{
  const csv = [
    'sku_id,title,price',
    'sku1,Camiseta,9.99 USD',
    ',,,',
    'Required. The product\u2019s unique ID as defined by the merchant.,Required. The name.,Required.',
    'Remove rows 4 & 5 before uploading. Learn more: https://ads.tiktok.com/help/article?aid=10001006,,',
  ].join('\n');
  const parsed = feed.parseCatalogCsv(csv);
  eq(parsed.products.length, 1, 'só 1 produto real (ignora vazio + 2 instruções)');
  eq(parsed.products[0].data.sku_id, 'sku1', 'sku extraído');
  eq(parsed.products[0].data.price, '9.99 USD', 'preço extraído');
}

console.log('validateProduct — obrigatórios');
{
  const r = feed.validateProduct({ sku_id: 'x' }, { currency: 'USD' });
  ok(!r.valid, 'produto sem título/preço/etc é inválido');
  ok(r.errors.some((e) => e.field === 'title'), 'acusa título faltando');
  ok(r.errors.some((e) => e.field === 'price'), 'acusa preço faltando');
}

console.log('validateProduct — preço e moeda');
{
  eq(feed.validatePriceField('9.99 USD', 'USD'), null, '"9.99 USD" com catálogo USD é válido');
  ok(feed.validatePriceField('9.99 BRL', 'USD'), 'moeda divergente é erro');
  ok(feed.validatePriceField('9,99 USD', 'USD'), 'vírgula decimal é erro (TikTok usa ponto)');
  ok(feed.validatePriceField('9.99', 'USD'), 'sem moeda é erro');
}

console.log('validateProduct — enums');
{
  const bad = feed.validateProduct({
    sku_id: 'x', title: 'T', description: 'D', availability: 'talvez',
    condition: 'new', price: '9.99 USD', link: 'https://x.com', image_link: 'https://x.com/a.jpg',
  }, { currency: 'USD' });
  ok(!bad.valid, 'availability inválido reprova');
  ok(bad.errors.some((e) => e.field === 'availability'), 'erro no campo availability');

  const good = feed.validateProduct({
    sku_id: 'x', title: 'T', description: 'D', availability: 'in stock',
    condition: 'new', price: '9.99 USD', link: 'https://x.com', image_link: 'https://x.com/a.jpg',
  }, { currency: 'USD' });
  ok(good.valid, 'produto completo e correto é válido');
}

console.log('validateProduct — URLs');
{
  const r = feed.validateProduct({
    sku_id: 'x', title: 'T', description: 'D', availability: 'in stock',
    condition: 'new', price: '9.99 USD', link: 'ftp://x.com', image_link: 'https://x.com/a.jpg',
  }, { currency: 'USD' });
  ok(r.errors.some((e) => e.field === 'link'), 'link não-http reprova');
}

console.log('buildCatalogCsv — ordem canônica + escaping');
{
  const csv = feed.buildCatalogCsv([
    { data: { sku_id: 's1', title: 'Camisa, azul', price: '9.99 USD', description: 'linha1\nlinha2' } },
  ]);
  const lines = csv.split('\n');
  eq(lines[0], feed.COLUMNS.join(','), 'cabeçalho é a ordem canônica');
  ok(lines[1].startsWith('s1,'), 'sku na primeira coluna');
  ok(csv.includes('"Camisa, azul"'), 'vírgula no valor é aspeada');
  ok(csv.includes('"linha1\nlinha2"'), 'quebra de linha é aspeada');
}

console.log('\nads-catalog-feed: ' + n + ' asserts OK');
