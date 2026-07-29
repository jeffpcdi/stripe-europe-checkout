'use strict';

const assert = require('assert');

const pixelStorePath = require.resolve('../pixel-store');
const dbPath = require.resolve('../db');
const redisPath = require.resolve('../redis');

function freshStore(db, redis) {
  delete require.cache[pixelStorePath];
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: db };
  require.cache[redisPath] = { id: redisPath, filename: redisPath, loaded: true, exports: redis };
  return require('../pixel-store');
}

function pixel(acc, slug, name) {
  return {
    acc,
    slug,
    name: name || slug,
    pixelCode: 'CODE_' + slug,
    accessToken: 'TOKEN_' + slug,
    active: true,
    events: { ViewContent: true, CompletePayment: true },
  };
}

(async () => {
  // Falha de qualquer camada configurada preserva o cache e é explícita.
  let store = freshStore({
    enabled: true,
    loadPixels: async () => ({ ok: true, data: [pixel('acc-a', 'falha')] }),
    deletePixel: async () => false,
  }, {
    enabled: true,
    loadPixelSnapshot: async () => [],
    deletePixelSnapshot: async () => false,
    savePixelSnapshot: async () => true,
  });
  await store.init();
  await assert.rejects(
    () => store.remove('acc-a', 'falha'),
    (error) => error && error.code === 'pixel_delete_not_durable' && error.status === 503,
    'falha durável deve chegar à rota com código e status estáveis',
  );
  assert.ok(store.get('acc-a', 'falha'), 'pixel fica no cache quando a persistência não confirma');

  // Neon vazio e bem-sucedido é autoritativo: Redis obsoleto não ressuscita.
  let snapshotReads = 0;
  store = freshStore({
    enabled: true,
    loadPixels: async () => ({ ok: true, data: [] }),
    deletePixel: async () => true,
  }, {
    enabled: true,
    loadPixelSnapshot: async () => {
      snapshotReads++;
      return [pixel('acc-a', 'removido')];
    },
    deletePixelSnapshot: async () => true,
    savePixelSnapshot: async () => true,
  });
  await store.init();
  assert.deepStrictEqual(store.list('acc-a'), [], 'Neon vazio não pode reidratar snapshot obsoleto');
  assert.strictEqual(snapshotReads, 0, 'snapshot só é fallback quando a leitura primária falha');

  // Sucesso remove apenas a conta pedida e confirma as duas persistências.
  const calls = [];
  store = freshStore({
    enabled: true,
    loadPixels: async () => ({
      ok: true,
      data: [pixel('acc-a', 'compartilhado', 'A'), pixel('acc-b', 'compartilhado', 'B')],
    }),
    deletePixel: async (acc, slug) => { calls.push('db:' + acc + ':' + slug); return true; },
  }, {
    enabled: true,
    loadPixelSnapshot: async () => [],
    deletePixelSnapshot: async (acc, slug) => { calls.push('redis:' + acc + ':' + slug); return true; },
    savePixelSnapshot: async () => true,
  });
  await store.init();
  assert.strictEqual(await store.remove('acc-a', 'compartilhado'), true);
  assert.strictEqual(store.get('acc-a', 'compartilhado'), null, 'pixel removido some da própria conta');
  assert.ok(store.get('acc-b', 'compartilhado'), 'mesmo slug de outra conta permanece');
  assert.deepStrictEqual(calls, [
    'redis:acc-a:compartilhado',
    'db:acc-a:compartilhado',
  ]);

  // Se o espelho sair, mas o Neon falhar, o snapshot é compensado e o cache
  // continua coerente para uma nova tentativa.
  const compensationCalls = [];
  store = freshStore({
    enabled: true,
    loadPixels: async () => ({ ok: true, data: [pixel('acc-a', 'compensa')] }),
    deletePixel: async () => false,
  }, {
    enabled: true,
    loadPixelSnapshot: async () => [],
    deletePixelSnapshot: async () => { compensationCalls.push('delete'); return true; },
    savePixelSnapshot: async (acc, slug) => {
      compensationCalls.push('restore:' + acc + ':' + slug);
      return true;
    },
  });
  await store.init();
  await assert.rejects(() => store.remove('acc-a', 'compensa'), /Neon/);
  assert.ok(store.get('acc-a', 'compensa'), 'falha no Neon preserva o pixel em memória');
  assert.deepStrictEqual(compensationCalls, ['delete', 'restore:acc-a:compensa']);

  delete require.cache[pixelStorePath];
  delete require.cache[dbPath];
  delete require.cache[redisPath];
  console.log('pixel-delete.test.js OK — persistência, anti-ressurreição e isolamento validados');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
