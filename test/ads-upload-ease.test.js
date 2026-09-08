'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('../dashboard/node_modules/typescript');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'roi-upload-test-'));
process.env.ADS_UPLOAD_DIR = root;
const storage = require('../ads-storage');
(async () => {
  try {
    assert(storage.safeName('a'.repeat(200) + '.mp4').endsWith('.mp4'), 'nome longo preserva extensão');
    const bytes = Buffer.from('video de teste');
    const names = await Promise.all(Array.from({ length: 4 }, () => storage.saveCreative('conta-a', 'video.mp4', bytes)));
    assert.equal(new Set(names).size, 1, 'retry concorrente reutiliza nome');
    assert.deepEqual(fs.readdirSync(storage.accountDir('conta-a')), [names[0]], 'nenhum arquivo parcial visível');
    assert.deepEqual(fs.readFileSync(path.join(storage.accountDir('conta-a'), names[0])), bytes);
    const different = await storage.saveCreative('conta-a', 'video.mp4', Buffer.from('outro conteúdo'));
    assert.notEqual(different, names[0], 'conteúdo novo não sobrescreve criativo anterior');
    await storage.saveCreative('conta-b', 'video.mp4', bytes);
    assert.notEqual(storage.accountDir('conta-a'), storage.accountDir('conta-b'));
    const code = ts.transpileModule(fs.readFileSync('dashboard/lib/ads-upload.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    let calls = 0, statuses = [503, 200];
    const context = { exports: {}, AbortController, URLSearchParams, Response,
      setTimeout: (fn, ms) => ms < 10000 ? setTimeout(fn, 0) : setTimeout(fn, ms), clearTimeout,
      fetch: async () => { calls++; return new Response('', { status: statuses.shift() || 200 }); },
    };
    vm.runInNewContext(code, context);
    const file = { name: 'video.mp4', size: 100 };
    assert.equal((await context.exports.uploadWithRetry(file, 'video')).status, 200);
    assert.equal(calls, 2, '503 é recuperado');
    calls = 0; statuses = [400];
    assert.equal((await context.exports.uploadWithRetry(file, 'video')).status, 400);
    assert.equal(calls, 1, 'erro de entrada não repete');
    await assert.rejects(context.exports.uploadWithRetry({ name: 'x.webm', size: 100 }, 'video'), /MP4/);
    assert.equal(calls, 1, 'formato não suportado bloqueia antes da rede');
    const abort = new AbortController(); abort.abort();
    await assert.rejects(context.exports.uploadWithRetry(file, 'video', { signal: abort.signal }));
    assert.equal(calls, 1, 'fechamento cancela fila');
    console.log('ads-upload-ease: retry, validação, cancelamento, atomicidade e isolamento OK');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
