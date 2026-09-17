'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { normalizeConversion } = require('../conversion-normalize');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

// Conversões: moeda ausente deve usar o contexto da conta e, sem contexto,
// o fallback real do produto (BRL). Isso evita multiplicar uma venda BRL como EUR.
{
  const body = { event: 'paid', order_id: 'o-1', amount: 100 };
  const eur = normalizeConversion(body, { currency: 'EUR' });
  const fallback = normalizeConversion(body, {});
  assert.equal(eur.currency, 'eur');
  assert.equal(fallback.currency, 'brl');
}

const server = read('server.js');
const gatewayStore = read('gateway-store.js');
const metrics = read('dashboard/lib/metrics.ts');
const cloakEntries = read('dashboard/components/cloak/cloak-entries-panel.tsx');
const conversions = read('dashboard/components/conversions/conversions-view.tsx');

// Deduplicação de webhook precisa incluir gateway. Dois provedores podem usar
// o mesmo order_id sem uma venda legítima ser descartada como duplicata.
assert.match(server, /seenWebhookOrder\(gw\.accountId,\s*n\.event,\s*n\.orderId,\s*n\.gateway \|\| gw\.provider\)/);
assert.match(server, /seenWebhookOrder\(n\.acc,\s*'pix_pending',\s*n\.orderId,\s*n\.gateway\)/);

// Log de conversão legado sem acc não pode vazar para uma conta comum.
assert.match(server, /!r\.acc && req\.account\.role === 'admin'/);

// Cloak: o mesmo POST usado pelos switches precisa ser merge-patch, preservando
// offerUrl/config existente em vez de exigir o formulário inteiro novamente.
assert.match(server, /const requestedSlug = b\.slug \? _ckSlugify\(b\.slug\) : ''/);
assert.match(server, /const existing = requestedSlug \? cur\.find/);
assert.match(server, /b\.offerUrl !== undefined[\s\S]{0,140}existing \? existing\.offerUrl/);
assert.match(server, /link de cloaking não encontrado/);

// Ações em massa do Cloak preservam selecionados que falharam, permitindo retry.
assert.match(cloakEntries, /const failed = new Set<string>\(\)/);
assert.match(cloakEntries, /setSelected\(failed\)/);
assert.match(cloakEntries, /Os que falharam continuam selecionados/);

// A tela ativa de Pixels precisa distinguir CREATE de UPDATE e carregar a
// revisão durável; o antigo componente de Pixels não participa mais da rota.
assert.match(conversions, /_createOnly:\s*!pixel/);
assert.match(conversions, /_baseUpdatedAt:\s*pixel\?\.updatedAt/);
assert.match(conversions, /clearAccessToken/);

// Funil histórico deve considerar quando cada etapa ocorreu, não apenas o estado
// final atual do lead (que causava compra futura vazando para período passado).
assert.match(metrics, /const purchaseInWindow = \(l: Lead\)/);
assert.match(metrics, /purchasedAt/);
assert.match(metrics, /leads\.filter\(purchaseInWindow\)\.length/);
assert.match(metrics, /if \(purchaseInWindow\(l\)\) c\.purchased\+\+/);

// Rotação de webhook: cache só muda após as gravações duráveis.
const persistPos = gatewayStore.indexOf('await db.upsertGateway(next)');
const snapshotPos = gatewayStore.indexOf('await redis.saveGatewaySnapshot(accountId, next.id, next)');
const cachePos = gatewayStore.indexOf('cache[idx] = next');
assert(persistPos >= 0 && snapshotPos > persistPos && cachePos > snapshotPos, 'rotação deve persistir antes de trocar o cache');

// A UI de Conversões precisa expor warning de persistência do pixel, em vez de
// declarar sucesso pleno quando o backend respondeu durable:false/warning.
assert.match(conversions, /durable\?: boolean; warning\?: string \| null/);
assert.match(conversions, /if \(saved\.warning\)/);

console.log('dashboard-functional-audit-v2: OK');
