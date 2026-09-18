'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const publicSlug = require('../public-slug');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// ── Slug pública: segura, curta, normalizada e com paths internos reservados.
assert.equal(publicSlug.normalize(' Oferta Black 2026! '), 'oferta-black-2026');
assert.equal(publicSlug.validate('api').ok, false);
assert.equal(publicSlug.validate('dashboard').code, 'slug_reserved');
assert.equal(publicSlug.validate('black-friday').ok, true);
const generated = new Set(Array.from({ length: 200 }, () => publicSlug.generate()));
assert.equal(generated.size, 200, 'geração aleatória não deve repetir em amostra pequena');
for (const slug of generated) assert.match(slug, /^[a-hj-km-np-z2-9]{8}$/);

// ── Link store: criação sem slug gera endereço aleatório e rename preserva identidade.
const linkStorePath = require.resolve('../link-store');
const dbPath = require.resolve('../db');
function freshStore() {
  const rows = new Map();
  const db = {
    enabled: true,
    loadLinks: async () => ({ ok: true, data: [...rows.values()].map((x) => JSON.parse(JSON.stringify(x))) }),
    upsertLink: async (acc, slug, data) => { rows.set(acc + ':' + slug, { ...data, acc, slug }); return true; },
    renameLink: async (acc, oldSlug, newSlug, data) => {
      const oldKey = acc + ':' + oldSlug;
      const newKey = acc + ':' + newSlug;
      if (!rows.has(oldKey) || rows.has(newKey)) return false;
      rows.delete(oldKey); rows.set(newKey, { ...data, acc, slug: newSlug }); return true;
    },
    deleteLink: async (acc, slug) => { rows.delete(acc + ':' + slug); return true; },
  };
  delete require.cache[linkStorePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  return { store: require('../link-store'), rows };
}

(async () => {
  const { store } = freshStore();
  await store.init();
  const variant = [{ id: 'v1', nome: 'A', url: 'https://checkout.example.com', peso: 100 }];
  const created = await store.save('acc-a', { _createOnly: true, nome: 'Oferta Principal', variantes: variant });
  assert.match(created.slug, /^[a-hj-km-np-z2-9]{8}$/);
  assert.notEqual(created.slug, 'oferta-principal');
  const oldSlug = created.slug;
  const renamed = await store.save('acc-a', {
    slug: 'Black Friday', _originalSlug: oldSlug, _baseUpdatedAt: created.updatedAt,
    nome: created.nome, variantes: variant,
  });
  assert.equal(renamed.slug, 'black-friday');
  assert.equal(store.get('acc-a', oldSlug), null);
  assert.equal(store.get('acc-a', 'black-friday').slug, 'black-friday');
  await assert.rejects(
    store.save('acc-a', { _createOnly: true, slug: 'api', nome: 'Reservado', variantes: variant }),
    (err) => err && err.code === 'slug_reserved',
  );

  // ── Contrato de roteamento: clean URL usa os MESMOS handlers das rotas legadas.
  const server = read('server.js');
  assert.match(server, /app\.get\('\/go\/:slug', handleCheckoutPublic\)/);
  assert.match(server, /app\.get\('\/c\/:slug', handleCloakPublic\)/);
  assert.match(server, /app\.get\('\/:slug',[\s\S]*?publicSlug\.normalize\(req\.params\.slug\)[\s\S]*?resolveCheckoutLink\(req\)[\s\S]*?resolveCloakEntry\(req\)/);
  assert.match(server, /if \(link && cloak\) return linkErrorPage\(res, 404\)/);
  assert.match(server, /function resolveCheckoutLink[\s\S]*?domain\.uso === 'cloaker'[\s\S]*?link\.dominio && link\.dominio !== host/, 'Link limpo deve respeitar o domínio escolhido e o uso do domínio');
  assert.match(server, /if \(link\) return handleCheckoutPublic\(req, res\)/);
  assert.match(server, /if \(cloak\) return handleCloakPublic\(req, res\)/);
  assert.ok(server.indexOf("app.get('/:slug'") > server.indexOf("app.use('/dashboard', pageAuth, proxyToNextDashboard)"), 'resolver limpo deve vir depois da dashboard');
  assert.ok(server.indexOf("app.get('/:slug'") > server.indexOf("app.get('/termos'"), 'resolver limpo deve vir depois das páginas específicas');
  assert.match(server, /function allowedOnCustomDomain[\s\S]*?isCleanPublicSlugPath\(p\)/, 'domínio personalizado deve liberar /:slug limpo');
  assert.match(server, /p\.startsWith\('\/c\/'\) \|\| isCleanPublicSlugPath\(p\)/, 'tracking genérico não pode duplicar pageview da URL limpa');

  // Namespace único e concorrência in-process nas mutações novas/renomes.
  assert.match(server, /publicSlugConflict\(req\.account\.id, body\.slug/);
  assert.match(server, /publicSlug\.reserve\(req\.account\.id, body\.slug\)/);
  assert.match(server, /publicSlugConflict\(req\.account\.id, slug, \{ cloakSlug:/);
  assert.match(server, /publicSlug\.reserve\(req\.account\.id, slug\)/);
  assert.match(server, /createKeyHash[\s\S]*?existing\.createKeyHash === createKeyHash[\s\S]*?replayed: true/, 'retry de criação do Cloaker deve continuar idempotente mesmo com slug editável');
  assert.match(read('db.js'), /async function renameLink[\s\S]*?UPDATE links[\s\S]*?NOT EXISTS/);

  // Dashboard nunca apresenta /go ou /c como URL principal.
  const linkEditor = read('dashboard/components/links/link-editor.tsx');
  const linksView = read('dashboard/components/links/links-view.tsx');
  const cloakEditor = read('dashboard/components/cloak/cloak-entry-editor.tsx');
  const cloakPanel = read('dashboard/components/cloak/cloak-entries-panel.tsx');
  assert.match(linkEditor, /const previewUrl = `https:\/\/\$\{previewHost\}\/\$\{previewSlug\}`/);
  assert.match(linksView, /return `https:\/\/\$\{host\}\/\$\{l\.slug\}`/);
  assert.match(cloakEditor, /const previewUrl = `https:\/\/\$\{previewHost\}\/\$\{previewSlug\}`/);
  assert.match(cloakPanel, /return `\$\{base\}\/\$\{e\.slug\}`/);
  for (const source of [linkEditor, linksView, cloakEditor, cloakPanel]) {
    assert.doesNotMatch(source, /https?:[^\n`'\"]*\/go\//, 'UI não deve montar URL principal com /go/');
    assert.doesNotMatch(source, /https?:[^\n`'\"]*\/c\//, 'UI não deve montar URL principal com /c/');
  }
  assert.match(linkEditor, /Gerar outro endereço/);
  assert.match(cloakEditor, /Gerar outro endereço/);
  assert.match(linkEditor, /Alterar o endereço pode fazer links já publicados pararem de funcionar/);
  assert.match(cloakEditor, /Alterar o endereço pode fazer links já publicados pararem de funcionar/);

  delete require.cache[linkStorePath];
  delete require.cache[dbPath];
  console.log('clean-public-urls-v16-18: URLs limpas, slug segura/editável, namespace e legado OK');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
