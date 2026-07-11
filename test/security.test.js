'use strict';
/*
 * Bateria do item 60 do plano — cobre os caminhos novos das correções 31–48:
 *
 * A. Anti-SSRF do verify-url (itens 5/9): ipPrivado bloqueia loopback,
 *    RFC1918, link-local, CGNAT e IPv6 interno; hostSeguro exige que TODOS
 *    os endereços resolvidos sejam públicos (bloqueia rebinding parcial).
 * B. Validação de host de domínio (item 43): normHost aceita host puro ou
 *    URL colada e rejeita lixo/injeção.
 * C. Idempotência de webhook por order_id (item 45): mesmo pedido → dedup;
 *    pedidos/contas/eventos diferentes → passam (fallback de memória).
 * D. Edição de gateway preserva webhookToken e segredo (item 33) e a
 *    rotação troca o token de propósito.
 * E. Normalização de pesos A/B no backend (item 36): clamp 0–100,
 *    contadores preservados na edição e validação de URL https://.
 *
 * Sem rede e sem banco: db stubado no require-cache; redis real com
 * enabled=false (snapshots viram no-op e o dedup usa o caminho de memória).
 */
process.env.KV_REST_API_URL = '';
process.env.KV_REST_API_TOKEN = '';
process.env.UPSTASH_REDIS_REST_URL = '';
process.env.UPSTASH_REDIS_REST_TOKEN = '';

const assert = require('assert');
const path = require('path');

// ── stub de ./db (Neon desligado) ───────────────────────────────────────────
const dbPath = path.resolve(__dirname, '..', 'db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { enabled: false }
};

const { ipPrivado, hostSeguro, normHost } = require('../security-helpers');
const redis = require('../redis');
const gatewayStore = require('../gateway-store');
const linkStore = require('../link-store');

(async () => {
  // ── A. Anti-SSRF ──────────────────────────────────────────────────────────
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.16.0.1', '172.31.255.255',
    '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '']) {
    assert.strictEqual(ipPrivado(ip), true, `deveria bloquear ${ip || '(vazio)'}`);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '2606:4700::1111']) {
    assert.strictEqual(ipPrivado(ip), false, `deveria liberar ${ip}`);
  }
  assert.strictEqual(ipPrivado('999.1.2'), true, 'IP malformado é bloqueado');

  // hostSeguro com lookup injetado (sem tocar DNS real)
  const mk = (addrs) => async () => addrs.map((address) => ({ address }));
  assert.strictEqual(await hostSeguro('ok.com', mk(['8.8.8.8'])), true);
  assert.strictEqual(await hostSeguro('interno.com', mk(['10.0.0.1'])), false);
  // rebinding parcial: um A público + um privado → bloqueia
  assert.strictEqual(await hostSeguro('rebind.com', mk(['8.8.8.8', '127.0.0.1'])), false);
  assert.strictEqual(await hostSeguro('semdns.com', mk([])), false);
  assert.strictEqual(await hostSeguro('erro.com', async () => { throw new Error('nx'); }), false);
  console.log('A. anti-SSRF (ipPrivado + hostSeguro) OK');

  // ── B. normHost (item 43) ─────────────────────────────────────────────────
  assert.strictEqual(normHost('Track.Minhaloja.COM'), 'track.minhaloja.com');
  assert.strictEqual(normHost('https://track.minhaloja.com/path?q=1'), 'track.minhaloja.com');
  assert.strictEqual(normHost('  loja.com.br  '), 'loja.com.br');
  for (const bad of ['', 'sem-ponto', 'a..b.com', '-inicia.com', 'txt;drop table', 'ex emplo.com', null]) {
    assert.strictEqual(normHost(bad), null, `deveria rejeitar ${JSON.stringify(bad)}`);
  }
  console.log('B. validação de host (normHost) OK');

  // ── C. idempotência de webhook (item 45) ──────────────────────────────────
  assert.strictEqual(await redis.seenWebhookOrder('acc1', 'CompletePayment', 'PED-1'), false, '1ª vez passa');
  assert.strictEqual(await redis.seenWebhookOrder('acc1', 'CompletePayment', 'PED-1'), true, 'retry é dedupado');
  assert.strictEqual(await redis.seenWebhookOrder('acc1', 'CompletePayment', 'PED-2'), false, 'pedido novo passa');
  assert.strictEqual(await redis.seenWebhookOrder('acc2', 'CompletePayment', 'PED-1'), false, 'conta diferente passa');
  assert.strictEqual(await redis.seenWebhookOrder('acc1', 'Refund', 'PED-1'), false, 'evento diferente passa');
  assert.strictEqual(await redis.seenWebhookOrder('acc1', 'CompletePayment', ''), false, 'sem order_id não deduplica');
  console.log('C. idempotência de webhook (dedup por conta+evento+order) OK');

  // ── D. edição de gateway preserva token (item 33) ─────────────────────────
  const g1 = await gatewayStore.save('acc1', { provider: 'kiwify', name: 'Kiwify Principal', secret: 's3gr3d0' });
  assert.ok(g1.id && g1.webhookToken, 'gateway criado com id e token');
  const g2 = await gatewayStore.save('acc1', { id: g1.id, provider: 'kiwify', name: 'Kiwify Renomeado' });
  assert.strictEqual(g2.webhookToken, g1.webhookToken, 'edição NÃO troca o webhookToken');
  assert.strictEqual(g2.secret, 's3gr3d0', 'edição sem secret preserva o segredo');
  assert.strictEqual(g2.name, 'Kiwify Renomeado');
  const rotated = await gatewayStore.rotateToken('acc1', g1.id);
  assert.ok(rotated && rotated.webhookToken !== g1.webhookToken, 'rotação troca o token');
  console.log('D. edição de gateway preserva webhookToken/segredo; rotação troca OK');

  // ── E. pesos e variantes no link-store (item 36) ──────────────────────────
  const l1 = await linkStore.save('acc1', {
    slug: 'oferta-x', nome: 'Oferta X',
    variantes: [
      { id: 'a', nome: 'A', url: 'https://pay.x.com/a', peso: 150 },  // clamp p/ 100
      { id: 'b', nome: 'B', url: 'https://pay.x.com/b', peso: -5 },   // vira default (>0)
      { id: 'c', nome: 'C', url: 'http://inseguro.com', peso: 50 }    // http → descartada
    ]
  });
  assert.strictEqual(l1.variantes.length, 2, 'variante http:// é descartada');
  const pa = l1.variantes.find((v) => v.id === 'a');
  const pb = l1.variantes.find((v) => v.id === 'b');
  assert.strictEqual(pa.peso, 100, 'peso >100 sofre clamp para 100');
  assert.ok(pb.peso > 0 && pb.peso <= 100, 'peso negativo cai no default 1–100');
  // edição preserva contadores por id de variante
  pa.clicks = 7; pa.conversions = 2; pa.revenue = 99.9;
  const l2 = await linkStore.save('acc1', {
    slug: 'oferta-x', nome: 'Oferta X v2',
    variantes: [{ id: 'a', nome: 'A2', url: 'https://pay.x.com/a2', peso: 60 }]
  });
  const pa2 = l2.variantes.find((v) => v.id === 'a');
  assert.strictEqual(pa2.clicks, 7, 'edição preserva clicks');
  assert.strictEqual(pa2.conversions, 2, 'edição preserva conversões');
  await assert.rejects(
    () => linkStore.save('acc1', { slug: 'vazio', nome: 'Vazio', variantes: [] }),
    /variante/, 'link sem variante válida é rejeitado'
  );
  await assert.rejects(
    () => linkStore.save('acc1', { slug: 'so-http', nome: 'Só http', variantes: [{ id: 'a', nome: 'A', url: 'http://x.com', peso: 100 }] }),
    /variante/, 'link só com URL http é rejeitado'
  );
  console.log('E. normalização de pesos + preservação de contadores OK');

  // ── F. item 473: nenhum console.* pode logar material sensível ────────────
  // Varredura estática dos módulos do backend: um console.log que concatene
  // req.headers.cookie, req.headers.authorization, password/secret do body ou
  // process.env inteiro é vazamento de credencial nos logs da plataforma.
  {
    const fs = require('fs');
    const files = fs.readdirSync(path.resolve(__dirname, '..'))
      .filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
    const LEAK = /console\.[a-z]+\([^)]*(req\.headers\.(cookie|authorization)|req\.headers\[['"](cookie|authorization)['"]\]|\bpassword\b|\bpassword_hash\b|process\.env\b(?!\.[A-Z]))/;
    const leaks = [];
    for (const f of files) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
      const lines = src.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (LEAK.test(lines[i])) leaks.push(f + ':' + (i + 1) + ' → ' + lines[i].trim().slice(0, 100));
      }
    }
    assert.deepStrictEqual(leaks, [], 'console.* logando material sensível:\n' + leaks.join('\n'));
    console.log('F. varredura de vazamento em logs (' + files.length + ' módulos limpos) OK');
  }

  console.log('\nsecurity.test.js: todos os cenários passaram.');
})().catch((err) => { console.error(err); process.exit(1); });
