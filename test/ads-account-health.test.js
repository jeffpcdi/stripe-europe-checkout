// Saúde das contas + tickets de desbanimento.
// Parte 1 (sempre): mapa de normalização de status do TikTok.
// Parte 2 (só com DATABASE_URL): transições de status, criação automática e
// idempotência de tickets, resolução automática na reativação. Usa uma conta
// sintética exclusiva e limpa os próprios registros no final.
const assert = require('assert');

const ops = require('../ads-ops-store');

// ── Normalização de status ──────────────────────────────────────────────────
assert.strictEqual(ops.normalizeAccountStatus('STATUS_ENABLE'), 'approved');
assert.strictEqual(ops.normalizeAccountStatus('STATUS_DISABLE'), 'banned');
assert.strictEqual(ops.normalizeAccountStatus('STATUS_PENALTY'), 'banned');
assert.strictEqual(ops.normalizeAccountStatus('STATUS_LIMIT'), 'limited');
assert.strictEqual(ops.normalizeAccountStatus('STATUS_PENDING_CONFIRM'), 'in_review');
assert.strictEqual(ops.normalizeAccountStatus('status_enable'), 'approved'); // case-insensitive
assert.strictEqual(ops.normalizeAccountStatus(''), 'unknown');
assert.strictEqual(ops.normalizeAccountStatus(null), 'unknown');
assert.strictEqual(ops.normalizeAccountStatus('ALGO_NOVO_DO_TIKTOK'), 'unknown');

async function main() {
  if (!ops.enabled) {
    console.log('ads-account-health.test.js OK — normalização validada (sem DATABASE_URL: transições puladas)');
    return;
  }

  const accId = 'test_health_' + Date.now().toString(36);
  const advId = 'adv_health_1';

  try {
    // 1º snapshot: approved — primeiro contato NÃO é transição
    let t = await ops.upsertAccountHealth(accId, [{ advertiserId: advId, name: 'Conta Teste', rawStatus: 'STATUS_ENABLE' }]);
    assert.deepStrictEqual(t, [], 'primeiro contato não deve gerar transição');

    // 2º snapshot: banido — transição approved → banned
    t = await ops.upsertAccountHealth(accId, [{ advertiserId: advId, name: 'Conta Teste', rawStatus: 'STATUS_DISABLE' }]);
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].from, 'approved');
    assert.strictEqual(t[0].to, 'banned');

    // health lista com first_seen_banned_at preenchido
    const health = await ops.listAccountHealth(accId);
    assert.strictEqual(health.length, 1);
    assert.strictEqual(health[0].status, 'banned');
    assert.ok(health[0].first_seen_banned_at, 'first_seen_banned_at deve ser gravado no banimento');

    // ticket automático: 1ª criação ok, 2ª é idempotente (retorna null)
    const ticket = await ops.createUnbanTicketIfAbsent(accId, { advertiserId: advId, advertiserName: 'Conta Teste', appealText: 'texto', appealUrl: 'https://example.com' });
    assert.ok(ticket && ticket.id, 'ticket deve ser criado na transição para banned');
    const dup = await ops.createUnbanTicketIfAbsent(accId, { advertiserId: advId, advertiserName: 'Conta Teste', appealText: 'outro', appealUrl: 'https://example.com' });
    assert.strictEqual(dup, null, 'não pode duplicar ticket ativo do mesmo advertiser');

    // mesmo status repetido não gera transição
    t = await ops.upsertAccountHealth(accId, [{ advertiserId: advId, name: 'Conta Teste', rawStatus: 'STATUS_DISABLE' }]);
    assert.deepStrictEqual(t, [], 'status repetido não deve gerar transição');

    // reativação: transição banned → approved + resolução automática do ticket
    t = await ops.upsertAccountHealth(accId, [{ advertiserId: advId, name: 'Conta Teste', rawStatus: 'STATUS_ENABLE' }]);
    assert.strictEqual(t.length, 1);
    assert.strictEqual(t[0].to, 'approved');
    const resolved = await ops.resolveTicketsForAdvertiser(accId, advId);
    assert.strictEqual(resolved.length, 1, 'ticket ativo deve ser resolvido na reativação');
    const tickets = await ops.listUnbanTickets(accId);
    assert.strictEqual(tickets[0].status, 'resolved');
    assert.ok(tickets[0].resolved_at, 'resolved_at deve ser gravado');

    // após resolvido, novo banimento pode abrir um NOVO ticket
    const again = await ops.createUnbanTicketIfAbsent(accId, { advertiserId: advId, advertiserName: 'Conta Teste', appealText: 'novo', appealUrl: 'https://example.com' });
    assert.ok(again && again.id, 'novo ticket deve ser possível após o anterior resolver');
    // edição: marcar como enviado
    const updated = await ops.updateUnbanTicket(accId, again.id, { status: 'submitted', appealText: 'editado' });
    assert.strictEqual(updated.status, 'submitted');
    assert.strictEqual(updated.appeal_text, 'editado');
    assert.ok(updated.submitted_at, 'submitted_at deve ser gravado');
  } finally {
    // limpeza: remove só os registros sintéticos desta rodada
    const { neon } = require('@neondatabase/serverless');
    const sql = neon(process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.NEON_DATABASE_URL);
    await sql`DELETE FROM ads_unban_tickets WHERE account_id = ${accId}`;
    await sql`DELETE FROM ads_account_health WHERE account_id = ${accId}`;
  }

  console.log('ads-account-health.test.js OK — normalização, transições, idempotência de tickets e resolução automática validadas');
}

main().catch((err) => { console.error(err); process.exit(1); });
