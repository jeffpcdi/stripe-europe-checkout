'use strict';

const assert = require('node:assert/strict');
const inspect = require('../ads-catalog-inspect');

assert.equal(inspect.isPrivateIp('127.0.0.1'), true);
assert.equal(inspect.isPrivateIp('10.0.0.1'), true);
assert.equal(inspect.isPrivateIp('192.168.1.10'), true);
assert.equal(inspect.isPrivateIp('8.8.8.8'), false);
assert.equal(inspect.isPrivateIp('::1'), true);

const html = `<!doctype html><html><head>
<meta property="og:title" content="Produto de teste">
<meta property="og:description" content="Descrição &amp; detalhes">
<meta property="og:image" content="https://cdn.example.com/image.jpg">
<script type="application/ld+json">{
  "@context":"https://schema.org", "@type":"Product", "name":"Produto JSON-LD",
  "description":"Descrição estruturada", "image":["https://cdn.example.com/product.jpg"],
  "offers":{"@type":"Offer","price":"19.90","priceCurrency":"BRL","availability":"https://schema.org/InStock"}
}</script></head><body></body></html>`;
const product = inspect.extractProduct(html, 'https://example.com/produto');
assert.equal(product.title, 'Produto JSON-LD');
assert.equal(product.description, 'Descrição estruturada');
assert.equal(product.image_link, 'https://cdn.example.com/product.jpg');
assert.equal(product.price, '19.90');
assert.equal(product.currency, 'BRL');
assert.equal(product.availability, 'in stock');
assert.equal(product.link, 'https://example.com/produto');

Promise.all([
  inspect.assertPublicUrl('http://127.0.0.1').then(() => assert.fail('localhost deveria ser bloqueado'), (error) => assert.match(error.message, /público/)),
  inspect.assertPublicUrl('ftp://example.com').then(() => assert.fail('FTP deveria ser bloqueado'), (error) => assert.match(error.message, /HTTP/)),
]).then(() => console.log('ads-catalog-inspect: segurança e extração OK'));
