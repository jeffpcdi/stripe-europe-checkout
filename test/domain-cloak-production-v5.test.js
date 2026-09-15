'use strict';

// V5: regressão de produção para Domínios + Proteção de tráfego.
// Os cenários de rede usam dependências injetadas no reconciliador; nenhum DNS,
// provider ou domínio real é tocado por este arquivo.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
// O ZIP de entrega não carrega node_modules. Para os testes unitários que não
// usam banco, simulamos apenas o import do driver Neon; db.enabled permanece false.
const Module = require('module');
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === '@neondatabase/serverless') return { neon: () => async () => [] };
  return originalLoad.call(this, request, parent, isMain);
};
const reconciler = require('../domain-reconciler');
const config = require('../config');
const redis = require('../redis');
const linkStore = require('../link-store');
Module._load = originalLoad;

let passed = 0;
async function test(name, fn) {
  try { await fn(); console.log('  ok  ' + name); passed++; }
  catch (err) { console.error('  XX  ' + name + '\n     ' + err.stack); process.exitCode = 1; }
}

const fakeDns = { resolveCname: async () => [] };
function fakeSecurity({ tls = true, marker = true } = {}) {
  return {
    APP_CHECK_ID: 'qa-app',
    resolvePublicHost: async (host) => [{ address: host === 'edge.example.net' ? '2.2.2.2' : '1.1.1.1', family: 4 }],
    tlsProbe: async () => tls ? { ok: true } : { ok: false, error: 'tls_pending' },
    httpsProbe: async () => marker
      ? { status: 200, body: JSON.stringify({ app: 'qa-app', proof: 'ok' }) }
      : { status: 503, body: '' },
    verifyDomainProof: () => marker,
  };
}
function providerWith(statusFactory, registerFactory) {
  return {
    enabled: true,
    name: 'qa-provider',
    register: registerFactory || (async () => ({ providerId: 'p1', provider: 'qa-provider', status: 'pending_dns', dns: { cname: { target: 'edge.example.net' } } })),
    status: statusFactory,
  };
}

async function main() {
  console.log('domain-cloak-production-v5.test.js');
  delete process.env.PUBLIC_APP_HOST;

  await test('fluxo pending_dns -> pending_ssl -> active mantém estado coerente', async () => {
    const base = { host: 'shop.qa.example', uso: 'ambos', verificado: false, criadoEm: new Date().toISOString() };
    let d = await reconciler.inspectDomain('acc-v5', base, {
      dns: fakeDns,
      security: fakeSecurity(),
      provider: providerWith(async () => ({ status: 'pending_dns', verified: false, dns: { cname: { target: 'edge.example.net' } } })),
    });
    assert.strictEqual(d.status, 'pending_dns');
    assert.strictEqual(d.verificado, false);

    d = await reconciler.inspectDomain('acc-v5', d, {
      dns: fakeDns,
      security: fakeSecurity({ tls: false, marker: true }),
      provider: providerWith(async () => ({ status: 'pending_ssl', verified: true, sslStatus: 'pending', dns: d.dns })),
    });
    assert.strictEqual(d.status, 'pending_ssl');
    assert.strictEqual(d.verificado, false);

    d = await reconciler.inspectDomain('acc-v5', d, {
      dns: fakeDns,
      security: fakeSecurity({ tls: true, marker: true }),
      provider: providerWith(async () => ({ status: 'active', verified: true, sslStatus: 'active', dns: d.dns })),
    });
    assert.strictEqual(d.status, 'active');
    assert.strictEqual(d.verificado, true);
    assert.ok(d.verificadoEm);
    assert.strictEqual(d.retryCount, 0);
  });

  await test('provider offline não apaga domínio nem produz falso active', async () => {
    const d = await reconciler.inspectDomain('acc-v5', { host: 'offline.qa.example', verificado: false, criadoEm: new Date().toISOString() }, {
      dns: fakeDns,
      security: fakeSecurity(),
      provider: providerWith(async () => null, async () => { throw new Error('provider offline'); }),
    });
    assert.strictEqual(d.host, 'offline.qa.example');
    assert.strictEqual(d.status, 'pending_dns');
    assert.match(d.lastError || '', /provider/i);
  });

  await test('binding remoto ausente é re-adotado automaticamente', async () => {
    let registerCalls = 0;
    const p = providerWith(async (id) => id === 'old' ? null : ({ status: 'active', verified: true, sslStatus: 'active' }), async () => {
      registerCalls++;
      return { providerId: 'new', provider: 'qa-provider', status: 'pending_ssl' };
    });
    const d = await reconciler.inspectDomain('acc-v5', { host: 'repair.qa.example', providerId: 'old', provider: 'qa-provider', status: 'pending_ssl', verificado: false }, {
      dns: fakeDns, security: fakeSecurity(), provider: p,
    });
    assert.strictEqual(registerCalls, 1);
    assert.strictEqual(d.providerId, 'new');
    assert.strictEqual(d.status, 'active');
  });

  await test('falha temporária não derruba domínio ativo no primeiro sinal', async () => {
    const p = { enabled: false, name: 'off' };
    let d = { host: 'stable.qa.example', status: 'active', verificado: true, retryCount: 0, criadoEm: new Date().toISOString() };
    d = await reconciler.inspectDomain('acc-v5', d, { dns: fakeDns, security: fakeSecurity(), provider: p });
    assert.strictEqual(d.status, 'active'); assert.strictEqual(d.verificado, true); assert.strictEqual(d.retryCount, 1);
    d = await reconciler.inspectDomain('acc-v5', d, { dns: fakeDns, security: fakeSecurity(), provider: p });
    assert.strictEqual(d.status, 'active'); assert.strictEqual(d.retryCount, 2);
    d = await reconciler.inspectDomain('acc-v5', d, { dns: fakeDns, security: fakeSecurity(), provider: p });
    assert.strictEqual(d.status, 'pending_dns'); assert.strictEqual(d.verificado, false); assert.strictEqual(d.retryCount, 3);
  });

  await test('índices multi-tenant falham fechado em domínio e slug duplicados', async () => {
    const stamp = Date.now().toString(36);
    const host = `dup-${stamp}.qa.example`;
    const slug = `dup-${stamp}`;
    config.seed('qa-a-' + stamp, { customDomains: [{ host, verificado: true }], cloakLinks: [{ slug }] });
    assert.ok(config.accountForDomain(host));
    assert.ok(config.accountForCloakSlug(slug));
    config.seed('qa-b-' + stamp, { customDomains: [{ host, verificado: true }], cloakLinks: [{ slug }] });
    assert.strictEqual(config.accountForDomain(host), null);
    assert.strictEqual(config.accountForCloakSlug(slug), null);
  });

  await test('checkout compartilhado também falha fechado com slug duplicado', async () => {
    const stamp = Date.now().toString(36);
    const slug = `checkout-${stamp}`;
    const base = { slug, nome: 'QA', ativo: true, variantes: [{ id: 'v1', nome: 'A', url: 'https://example.com/a', peso: 100 }] };
    await linkStore.save('qa-link-a-' + stamp, { ...base });
    await linkStore.save('qa-link-b-' + stamp, { ...base });
    assert.strictEqual(linkStore.resolve(slug), null);
    assert.strictEqual(linkStore.resolve(slug, 'qa-link-a-' + stamp).acc, 'qa-link-a-' + stamp);
    assert.strictEqual(linkStore.resolve(slug, 'conta-inexistente'), null);
  });

  await test('Redis offline mantém velocity local em vez de desativar proteção', async () => {
    if (redis.enabled) return; // integração Redis é coberta pelo durable-flows quando configurada
    const id = 'v5-' + Date.now();
    assert.strictEqual(await redis.bumpVelocity('qa', id, 60), 1);
    assert.strictEqual(await redis.bumpVelocity('qa', id, 60), 2);
  });

  const root = path.join(__dirname, '..');
  const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
  const cfg = fs.readFileSync(path.join(root, 'config.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
  const links = fs.readFileSync(path.join(root, 'link-store.js'), 'utf8');
  const profiles = fs.readFileSync(path.join(root, 'cloak-test-profiles.js'), 'utf8');

  await test('domínio só entra em Links/Cloaker depois de verificado e ativo', async () => {
    assert.match(server, /link_domain_not_verified/);
    assert.match(server, /cloak_domain_not_verified/);
    assert.match(server, /domain\.status && domain\.status !== 'active'/);
    assert.match(server, /allowedDomain\.status && allowedDomain\.status !== 'active'/);
  });

  await test('remoção/toggle de Cloaker usa revisão otimista', async () => {
    assert.match(server, /baseUpdatedAt/);
    assert.match(server, /cloak_revision_conflict/);
    const ui = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-entries-panel.tsx'), 'utf8');
    assert.match(ui, /_baseUpdatedAt: e\.updatedAt/);
    assert.match(ui, /\?baseUpdatedAt=/);
  });

  await test('config preserva camadas e estado de domínio após restart real do processo', async () => {
    for (const key of ['checkWebview', 'checkCoherence', 'checkEntropy']) {
      assert.match(cfg, new RegExp(key + ':\\s+boolOr\\(c\\.' + key));
      assert.match(cfg, new RegExp(key + ':\\s+boolOr\\(l\\.' + key));
    }
    for (const key of ['status', 'sslStatus', 'lastCheckedAt', 'lastError', 'retryCount', 'nextCheckAt']) {
      assert.ok(cfg.includes(key), key + ' ausente da sanitização de customDomains');
    }

    const dataFile = path.join(root, 'data', 'config.json');
    const hadFile = fs.existsSync(dataFile);
    const before = hadFile ? fs.readFileSync(dataFile) : null;
    const stamp = Date.now().toString(36);
    const acc = 'qa-restart-' + stamp;
    const host = `restart-${stamp}.qa.example`;
    const stubRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'roinados-v5-node-'));
    try {
      await config.setDurable(acc, {
        customDomains: [{ host, uso: 'ambos', verificado: false, status: 'pending_ssl', sslStatus: 'pending', retryCount: 2, nextCheckAt: '2099-01-01T00:00:00.000Z', criadoEm: new Date().toISOString() }],
        cloak: { ...config.defaults().cloak, checkWebview: false, checkCoherence: false, checkEntropy: false },
      });
      const neonDir = path.join(stubRoot, '@neondatabase', 'serverless');
      fs.mkdirSync(neonDir, { recursive: true });
      fs.writeFileSync(path.join(neonDir, 'index.js'), "module.exports={neon:()=>async()=>[]};\n");
      const script = `const c=require(${JSON.stringify(path.join(root, 'config.js'))});(async()=>{await c.hydrate();const x=c.get(${JSON.stringify(acc)});const d=(x.customDomains||[])[0];console.log('V5JSON:'+JSON.stringify({host:d&&d.host,status:d&&d.status,sslStatus:d&&d.sslStatus,retryCount:d&&d.retryCount,nextCheckAt:d&&d.nextCheckAt,webview:x.cloak&&x.cloak.checkWebview,coherence:x.cloak&&x.cloak.checkCoherence,entropy:x.cloak&&x.cloak.checkEntropy}));})().catch(e=>{console.error(e);process.exit(1)});`;
      const child = spawnSync(process.execPath, ['-e', script], {
        cwd: root, encoding: 'utf8',
        env: { ...process.env, NODE_PATH: stubRoot, DATABASE_URL: '', UPSTASH_REDIS_REST_URL: '', UPSTASH_REDIS_REST_TOKEN: '' },
      });
      assert.strictEqual(child.status, 0, child.stderr || child.stdout);
      const line = child.stdout.split(/\r?\n/).find((x) => x.startsWith('V5JSON:'));
      assert.ok(line, child.stdout);
      const restored = JSON.parse(line.slice('V5JSON:'.length));
      assert.deepStrictEqual(restored, { host, status: 'pending_ssl', sslStatus: 'pending', retryCount: 2, nextCheckAt: '2099-01-01T00:00:00.000Z', webview: false, coherence: false, entropy: false });
    } finally {
      fs.rmSync(stubRoot, { recursive: true, force: true });
      if (hadFile) fs.writeFileSync(dataFile, before);
      else fs.rmSync(dataFile, { force: true });
    }
  });

  await test('CAS multi-instância impede overwrite silencioso da config', async () => {
    assert.match(db, /saveConfigVersioned/);
    assert.match(db, /COALESCE\(data->>'updatedAt', ''\)/);
    assert.match(cfg, /db\.saveConfigVersioned/);
    assert.match(cfg, /Worker\/reconciliador: refaz o merge/);
  });

  await test('checkout compartilhado falha fechado quando slug é ambíguo', async () => {
    assert.match(links, /const matches = cache\.filter/);
    assert.match(links, /matches\.length === 1 \? matches\[0\] : null/);
    assert.match(links, /if \(preferredAccountId\)[\s\S]*return cache\.find[\s\S]*\|\| null/);
  });

  await test('remoção de domínio é provider-first e fluxo selecionar/trocar/remover fica protegido', async () => {
    const deleteStart = server.indexOf("app.delete('/api/domains/:host'");
    const deleteEnd = server.indexOf("// Verificação em 2 passos", deleteStart);
    const del = server.slice(deleteStart, deleteEnd);
    assert.ok(deleteStart >= 0 && deleteEnd > deleteStart);
    assert.match(del, /domain_in_use/);
    assert.match(del, /providerForDomainEntry\(found\)/);
    assert.match(del, /domain_provider_unavailable/);
    assert.ok(del.indexOf('domainProvider.remove') < del.indexOf('config.setDurable'), 'provider remoto deve ser removido antes do commit local');
    const domainsUi = fs.readFileSync(path.join(root, 'dashboard/components/domains/domains-view.tsx'), 'utf8');
    const editorUi = fs.readFileSync(path.join(root, 'dashboard/components/cloak/cloak-entry-editor.tsx'), 'utf8');
    assert.match(domainsUi, /\/links\?novo=1&dominio=/);
    assert.match(domainsUi, /\/cloak\?novo=1&dominio=/);
    assert.match(editorUi, /verifiedDomains/);
    assert.match(links, /existing\.dominio !== merged\.dominio/);
  });

  await test('catálogo QA é genérico e não modela revisores de plataforma', async () => {
    assert.ok(!/ByteDance/i.test(profiles));
    assert.ok(!/TikTok/i.test(profiles));
    assert.ok(profiles.includes('datacenter-automation'));
    assert.ok(profiles.includes('generic-crawler'));
  });

  await test('novos links protegidos não dependem de mobile/ad-click por padrão', async () => {
    assert.match(server, /existing \? existing\.mobileOnly !== false : false/);
    assert.match(server, /requireAdClick:\s*false/);
  });

  if (!process.exitCode) console.log(`\n${passed} cenários V5 OK`);
}

main();
