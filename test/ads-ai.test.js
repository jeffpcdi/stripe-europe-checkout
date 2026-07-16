// Testes da camada de IA (ads-ai.js):
// A. REGRA DE OURO — ads-ai.js não importa pipeboard-mcp/ads-provider (fonte)
// B. detectAnomalies — z-score, mínimos anti-ruído, direção/severidade
// C. validateProposedAction — schema, clamps, IDs contra o espelho
// D. budgetProposal — guardas: teto global, mín. 2 vendas, ±30%, exclusões
// Nenhum teste toca rede/Neon/IA: cache e atribuição são stubs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const adsAi = require('../ads-ai');

let asserts = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); asserts += 1; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, msg); asserts += 1; };

// ── A. Regra de ouro: zero imports da Pipeboard no módulo de IA ─────────────
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'ads-ai.js'), 'utf8');
  ok(!/require\(\s*['"]\.\/pipeboard-mcp['"]\s*\)/.test(src), 'ads-ai não pode importar pipeboard-mcp');
  ok(!/require\(\s*['"]\.\/ads-provider['"]\s*\)/.test(src), 'ads-ai não pode importar ads-provider');
  ok(!/require\(\s*['"]\.\/zernio['"]\s*\)/.test(src), 'ads-ai não pode importar zernio');
  ok(!/callTool|listTools/.test(src), 'ads-ai não pode chamar tools MCP diretamente');
  console.log('A. regra de ouro (zero Pipeboard em ads-ai.js) OK');
}

// ── Stubs para B/C/D ─────────────────────────────────────────────────────────
let treeCampaigns = [];
let leadsByCampaign = {};
adsAi.init({
  cache: {
    readTree: async () => ({ campaigns: treeCampaigns }),
    readAdvertiserTotals: async () => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0 }),
    readDailySeries: async () => [],
    listBriefings: async () => [],
    upsertBriefing: async () => true,
  },
  computeAttribution: () => ({ byCampaign: leadsByCampaign, unattributed: { revenueCents: 0, sales: 0 } }),
  getRules: () => [],
  getRulesLog: () => [],
  sendPushcut: async () => {},
});

function day(d, spend, impressions, clicks, conversions) {
  return { day: d, spend, impressions, clicks, conversions };
}

// ── B. detectAnomalies ───────────────────────────────────────────────────────
{
  // base estável com variância pequena mas não-nula em TODAS as métricas
  // (sd=0 é pulado pelo detector) + último dia anômalo
  const base = ['01', '02', '03', '04', '05', '06', '07'].map((n, i) =>
    day('2026-07-' + n, 50 + (i % 3), 10000 + i * 50, 200 + (i % 4), 10),
  );
  const spike = [...base, day('2026-07-08', 150, 10000, 200, 10)];
  const a1 = adsAi.detectAnomalies(spike);
  ok(a1.some((x) => x.metric === 'spend' && x.direction === 'up' && x.severity === 'bad'), 'gasto 3× vira anomalia bad');

  // CTR caindo: cliques despencam no último dia → ctr down/bad
  const ctrDrop = [...base, day('2026-07-08', 51, 10000, 20, 10)];
  const a2 = adsAi.detectAnomalies(ctrDrop);
  ok(a2.some((x) => x.metric === 'ctr' && x.direction === 'down' && x.severity === 'bad'), 'CTR caindo vira anomalia bad');

  // série estável → sem anomalias
  const flat = [...base, day('2026-07-08', 51, 10000, 201, 10)];
  eq(adsAi.detectAnomalies(flat).length, 0, 'série estável não gera anomalia');

  // mínimos anti-ruído: dias com < 500 impressões são ignorados (< 4 dias válidos → [])
  const noisy = [day('2026-07-01', 50, 100, 5, 0), day('2026-07-02', 50, 200, 5, 0), day('2026-07-03', 50, 300, 5, 0), day('2026-07-04', 500, 400, 5, 0)];
  eq(adsAi.detectAnomalies(noisy).length, 0, 'dias abaixo do mínimo de impressões não contam');

  // menos de 4 dias válidos → sem estatística
  eq(adsAi.detectAnomalies(base.slice(0, 3)).length, 0, 'menos de 4 dias → sem anomalias');
  console.log('B. detectAnomalies (z-score, direção, mínimos) OK —', asserts, 'asserts');
}

// ── C. validateProposedAction ────────────────────────────────────────────────
{
  const known = new Set(['1111111111', '2222222222']);

  // pause válido
  const v1 = adsAi.validateProposedAction({ type: 'pause', params: { campaignIds: ['1111111111'] } }, known);
  ok(v1.ok, 'pause com ID conhecido passa');

  // ID alucinado (não está no espelho) → rejeita
  const v2 = adsAi.validateProposedAction({ type: 'pause', params: { campaignIds: ['9999999999'] } }, known);
  ok(!v2.ok && /não existem no espelho/.test(v2.error), 'ID fora do espelho é rejeitado');

  // ID não-numérico → rejeita
  ok(!adsAi.validateProposedAction({ type: 'pause', params: { campaignIds: ['abc; DROP'] } }, known).ok, 'ID não-numérico rejeitado');

  // mais de 20 IDs → rejeita
  const many = Array.from({ length: 21 }, (_, i) => String(10000000000 + i));
  ok(!adsAi.validateProposedAction({ type: 'pause', params: { campaignIds: many } }, null).ok, 'mais de 20 IDs rejeitado');

  // budget fora do intervalo → rejeita; dentro → passa com clamp de 2 casas
  ok(!adsAi.validateProposedAction({ type: 'budget', params: { campaignId: '1111111111', budget: 3 } }, known).ok, 'budget < 5 rejeitado');
  ok(!adsAi.validateProposedAction({ type: 'budget', params: { campaignId: '1111111111', budget: 20000 } }, known).ok, 'budget > 10000 rejeitado');
  const v3 = adsAi.validateProposedAction({ type: 'budget', params: { campaignId: '1111111111', budget: 33.333 } }, known);
  ok(v3.ok && v3.params.budget === 33.33, 'budget válido normalizado para 2 casas');

  // duplicate não existe mais (backend 501) → rejeita
  ok(!adsAi.validateProposedAction({ type: 'duplicate', params: { campaignId: '1111111111' } }, known).ok, 'duplicate não é mais um tipo válido');

  // tipo desconhecido / ação vazia
  ok(!adsAi.validateProposedAction({ type: 'delete_all' }, known).ok, 'tipo desconhecido rejeitado');
  ok(!adsAi.validateProposedAction(null, known).ok, 'ação nula rejeitada');
  console.log('C. validateProposedAction (schema, espelho, clamps) OK —', asserts, 'asserts');
}

// ── D. budgetProposal — guardas determinísticas (sem IA: AI_GATEWAY_API_KEY off) ──
{
  // garante caminho sem IA (rationale vazio): remove todas as credenciais que habilitam IA
  delete process.env.AI_GATEWAY_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  const camp = (id, name, budget, spend, status = 'active') => ({
    platformCampaignId: id, name, status, budget, budgetMode: 'daily',
    metrics: { spend, impressions: 10000, clicks: 100, conversions: 5 },
    adSets: [],
  });

  (async () => {
    // Cenário: A com ROAS alto (4 vendas), B sem vendas → verba migra A←B dentro dos limites
    treeCampaigns = [camp('1111111111', 'Vencedora', 100, 200), camp('2222222222', 'Perdedora', 100, 200)];
    leadsByCampaign = { 1111111111: { revenueCents: 80000, sales: 4 } }; // ROAS 4.0
    const p = await adsAi.budgetProposal('acc1', 'adv1', 'USD');
    ok(Array.isArray(p.changes) && p.changes.length >= 1, 'proposta gerada com mudanças');
    const total = p.changes.reduce((a, c) => a + c.proposed, 0) +
      (p.unchanged || []).reduce((a, u) => {
        const orig = treeCampaigns.find((c) => c.platformCampaignId === u.id);
        return a + (orig ? orig.budget : 0);
      }, 0);
    ok(total <= p.totalBudget + 0.01, 'teto global respeitado (realocar nunca aumenta o total)');
    for (const ch of p.changes) {
      ok(ch.proposed >= ch.current * 0.7 - 0.01 && ch.proposed <= ch.current * 1.3 + 0.01, 'ajuste dentro de ±30%: ' + ch.name);
      ok(ch.proposed >= 5, 'piso de 5 respeitado');
    }
    const winner = p.changes.find((c) => c.campaignId === '1111111111');
    if (winner) ok(winner.deltaPct > 0, 'vencedora (2+ vendas) recebe verba');
    eq(p.rationale, '', 'sem credenciais de IA o rationale fica vazio (proposta continua válida)');

    // Menos de 2 elegíveis → insufficient
    treeCampaigns = [camp('1111111111', 'Única', 100, 200)];
    const p2 = await adsAi.budgetProposal('acc1', 'adv1', 'USD');
    ok(p2.insufficient, 'menos de 2 campanhas elegíveis → insufficient');

    // Pausadas/sem budget diário ficam de fora, com motivo
    treeCampaigns = [
      camp('1111111111', 'Ativa A', 100, 200), camp('2222222222', 'Ativa B', 100, 200),
      camp('3333333333', 'Pausada', 100, 200, 'paused'), camp('4444444444', 'Sem budget', 0, 200),
    ];
    leadsByCampaign = { 1111111111: { revenueCents: 80000, sales: 4 } };
    const p3 = await adsAi.budgetProposal('acc1', 'adv1', 'USD');
    eq((p3.excluded || []).length, 2, 'pausada + sem budget são excluídas');
    ok(p3.excluded.every((e) => e.reason), 'exclusões têm motivo legível');

    // enabled() false sem a chave
    eq(adsAi.enabled(), false, 'enabled() false sem credenciais de IA');
    console.log('D. budgetProposal (teto, ±30%, exclusões, sem-IA) OK');
    console.log('ads-ai: ' + asserts + ' asserts OK');
  })().catch((err) => { console.error('FALHOU:', err.message); process.exit(1); });
}
