'use strict';

const assert = require('assert');
const safety = require('../catalog/catalog-campaign-safety');
const provider = require('../ads-provider');
const pipeboard = require('../pipeboard-mcp');

let assertions = 0;
function ok(value, label) {
  assert.ok(value, label);
  assertions += 1;
  console.log('  ✓ ' + label);
}

(async () => {
  console.log('Segurança da criação de campanhas de catálogo');

  const next = safety.nextAvailableCampaignName(
    'ecom — VSA 01',
    ['ecom — VSA 01', 'ecom — VSA 02', 'ecom — VSA 03', 'ecom — VSA 05'],
  );
  ok(next === 'ecom — VSA 04', 'preenche o primeiro número livre da sequência');
  ok(
    safety.nextAvailableCampaignName('Oferta', ['oferta', 'Oferta — 02']) === 'Oferta — 03',
    'comparação é tolerante a maiúsculas e evita colisão visual',
  );
  const long = safety.nextAvailableCampaignName('x'.repeat(512), ['x'.repeat(512)]);
  ok(long.length <= 512 && /— 02$/.test(long), 'preserva o sufixo dentro do limite de 512 caracteres');
  ok(
    safety.isCampaignNameConflict(new Error('TikTok API error 40002: Campaign name already exists. Please try another one.')),
    'reconhece conflito de nome pela causa, não apenas pelo código 40002',
  );
  ok(
    !safety.isCampaignNameConflict(new Error('TikTok API error 40002: Please select a pixel.')),
    'não confunde outro 40002 com conflito de nome',
  );

  const cases = [
    ['TikTok API error 40002: Your budget setting must not be less than $50.', 'CATALOG_BUDGET_INVALID', false],
    ['TikTok API error 40002: Please select a pixel.', 'CATALOG_PIXEL_INVALID', false],
    ['TikTok API error 40002: Could not find catalogue ID.', 'CATALOG_ACCESS_INVALID', false],
    ['targeting is required with at least location_ids', 'CATALOG_TARGETING_INVALID', false],
    ['Custom identities are no longer supported.', 'CATALOG_IDENTITY_INVALID', false],
    ['TikTok API error 40002: Invalid vertical video selection', 'CATALOG_CREATIVE_INVALID', false],
    ['TikTok API error 40002: Could not acquire IP. Please try again later', 'CATALOG_TIKTOK_TEMPORARY', true],
  ];
  for (const [message, code, retryable] of cases) {
    const classified = safety.classifyCatalogCreationError(new Error(message));
    ok(classified.code === code && classified.retryable === retryable, 'classifica ' + code);
  }
  const request = safety.classifyCatalogCreationError(new Error(
    'falha — TikTok request_id: 20260804030224AE6C21C6A3C07DD5040F',
  ));
  ok(request.providerRequestId === '20260804030224AE6C21C6A3C07DD5040F', 'preserva request_id para suporte');

  const originalCall = pipeboard.callTool;
  const createdNames = [];
  const progressNames = [];
  try {
    pipeboard.callTool = async (tool, args) => {
      if (tool === 'get_tiktok_campaigns') {
        return {
          campaigns: [
            { campaign_id: '1', campaign_name: 'ecom — VSA 01' },
            { campaign_id: '2', campaign_name: 'ecom — VSA 02' },
          ],
          page_info: { page: 1, total_page: 1, total_number: 2 },
        };
      }
      if (tool === 'create_tiktok_campaign') {
        createdNames.push(args.campaign_name);
        if (args.campaign_name === 'ecom — VSA 03') {
          throw new Error('TikTok API error 40002: Campaign name already exists. Please try another one.');
        }
        return { campaign_id: 'new-campaign' };
      }
      throw new Error('tool inesperada: ' + tool);
    };
    const warnings = [];
    const result = await provider._internals.createUniqueCatalogCampaignEntity(
      'adv-1',
      'ecom — VSA 01',
      { advertiser_id: 'adv-1', objective_type: 'PRODUCT_SALES', operation_status: 'DISABLE' },
      {
        warnings,
        onName: async (name) => progressNames.push(name),
      },
    );
    ok(
      JSON.stringify(createdNames) === JSON.stringify(['ecom — VSA 03', 'ecom — VSA 04']),
      'corrige também a corrida em que o nome é ocupado entre preflight e criação',
    );
    ok(result.name === 'ecom — VSA 04', 'devolve o nome efetivamente criado');
    ok(progressNames.at(-1) === 'ecom — VSA 04', 'persiste o nome efetivo antes de avançar a hierarquia');
    ok(warnings.some((warning) => /renomeada automaticamente/.test(warning)), 'explica a renumeração sem pedir ação manual');
  } finally {
    pipeboard.callTool = originalCall;
  }

  const suspended = { healthStatus: 'banned' };
  try {
    provider._internals.assertAdvertiserCanCreateCatalogCampaign(suspended);
    ok(false, 'conta suspensa deveria falhar');
  } catch (error) {
    ok(error.code === 'CATALOG_ACCOUNT_SUSPENDED' && error.retryable === false, 'conta suspensa falha antes de upload/escrita');
  }

  console.log('\nads-catalog-campaign-safety: ' + assertions + ' asserts OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
