'use strict';

const MAX_CAMPAIGN_NAME_LENGTH = 512;
const MAX_NAME_ATTEMPTS = 50;

function normalizedNameKey(value) {
  return String(value || '').trim().normalize('NFKC').toLocaleLowerCase('pt-BR');
}

function fitName(root, suffix, maxLength) {
  const limit = Math.max(1, Number(maxLength) || MAX_CAMPAIGN_NAME_LENGTH);
  const tail = String(suffix || '');
  return String(root || '').slice(0, Math.max(1, limit - tail.length)) + tail;
}

function nextAvailableCampaignName(requestedName, existingNames, maxLength) {
  const limit = Math.max(1, Number(maxLength) || MAX_CAMPAIGN_NAME_LENGTH);
  const requested = String(requestedName || '').trim().slice(0, limit);
  if (!requested) throw new Error('Nome da campanha é obrigatório');
  const used = new Set((Array.isArray(existingNames) ? existingNames : [])
    .map(normalizedNameKey).filter(Boolean));
  if (!used.has(normalizedNameKey(requested))) return requested;

  // Se o nome já termina em número, incrementa esse número. Assim
  // "ecom — VSA 01" vira "ecom — VSA 06" quando 01…05 já existem.
  const numbered = requested.match(/^(.*?)(\d+)$/u);
  const root = numbered ? numbered[1] : requested;
  const initial = numbered ? Number(numbered[2]) + 1 : 2;
  const width = numbered ? Math.max(2, numbered[2].length) : 2;
  for (let number = initial; number < initial + 10_000; number += 1) {
    const suffix = numbered
      ? String(number).padStart(width, '0')
      : ' — ' + String(number).padStart(width, '0');
    const candidate = fitName(root, suffix, limit);
    if (!used.has(normalizedNameKey(candidate))) return candidate;
  }
  throw new Error('Não foi possível gerar um nome de campanha disponível');
}

function isCampaignNameConflict(value) {
  const message = String(value && value.message || value || '');
  return /campaign\s+name\s+already\s+exists/i.test(message)
    || /nome\s+da\s+campanha\s+j[aá]\s+existe/i.test(message);
}

function providerRequestId(value) {
  const message = String(value && value.message || value || '');
  const match = message.match(/(?:TikTok\s+request[_\s-]*id|request[_\s-]*id)\s*:\s*([A-Za-z0-9_-]+)/i);
  return match ? match[1] : null;
}

const ERROR_RULES = Object.freeze([
  {
    code: 'CATALOG_CAMPAIGN_NAME_CONFLICT',
    test: isCampaignNameConflict,
    userMessage: 'O nome da campanha já estava em uso.',
    suggestedAction: 'A dashboard escolherá o próximo número disponível automaticamente.',
    retryable: true,
  },
  {
    code: 'CATALOG_ACCOUNT_UNAVAILABLE',
    test: (message) => /advertiser.+not one of the accounts|(?:advertiser|account).+not authori[sz]ed|unauthori[sz]ed advertiser|account.+(?:suspend|punish|disabled|not approved)|advertiser.+(?:suspend|punish|disabled)/i.test(message),
    userMessage: 'A conta de anúncio não está disponível para criar campanhas.',
    suggestedAction: 'Selecione uma conta aprovada e autorizada nesta conexão do TikTok.',
    retryable: false,
  },
  {
    code: 'CATALOG_BUDGET_INVALID',
    test: (message) => /budget.+(?:invalid|must not be less|minimum|below)|budget[_\s-]*mode.+(?:invalid|required|not supported)|dynamic daily budget/i.test(message),
    userMessage: 'O TikTok recusou a configuração de orçamento.',
    suggestedAction: 'Use o orçamento mínimo indicado e mantenha o orçamento no nível correto: campanha para CBO ou conjunto para ABO.',
    retryable: false,
  },
  {
    code: 'CATALOG_PIXEL_INVALID',
    test: (message) => /select a pixel|pixel.+(?:invalid|required|not found|unavailable)|select a pixel event|optimization[_\s-]*event.+(?:invalid|required)/i.test(message),
    userMessage: 'O Pixel ou o evento de Compra não está disponível para esta campanha.',
    suggestedAction: 'Aguarde o Pixel receber uma Compra real ou corrija o vínculo central em Conversões.',
    retryable: false,
  },
  {
    code: 'CATALOG_ACCESS_INVALID',
    test: (message) => /could not find catalogue|could not find catalog|catalog(?:ue)? id.+(?:invalid|not found)|catalog.+(?:access|permission|authori[sz])/i.test(message),
    userMessage: 'O catálogo não está autorizado nesta conta de anúncio.',
    suggestedAction: 'Atualize a conexão do catálogo e confirme que catálogo, Business Center e advertiser pertencem ao mesmo acesso.',
    retryable: false,
  },
  {
    code: 'CATALOG_TARGETING_INVALID',
    test: (message) => /targeting.+required|location[_\s-]*ids?.+(?:required|invalid)|missing required field.+placements|region.+(?:invalid|not available)/i.test(message),
    userMessage: 'A segmentação não é válida para esta conta e objetivo.',
    suggestedAction: 'A dashboard atualizará as regiões aceitas pelo TikTok antes de uma nova tentativa.',
    retryable: false,
  },
  {
    code: 'CATALOG_IDENTITY_INVALID',
    test: (message) => /custom identities are no longer supported|no longer have access|re-apply for access|select a new identity|identity.+(?:invalid|required|not authori[sz]ed)/i.test(message),
    userMessage: 'Nenhuma identidade autorizada pôde publicar este anúncio.',
    suggestedAction: 'Autorize uma conta TikTok no mesmo Business Center com dark post habilitado.',
    retryable: false,
  },
  {
    code: 'CATALOG_CREATIVE_INVALID',
    test: (message) => /invalid vertical video|video.+(?:format|duration|resolution|codec|invalid)|image.+(?:format|invalid)|creative.+(?:invalid|required)|ad[_\s-]*format.+invalid/i.test(message),
    userMessage: 'O TikTok recusou o formato do criativo.',
    suggestedAction: 'Use um vídeo MP4 ou MOV vertical compatível. A dashboard reutiliza o áudio e a capa do próprio arquivo.',
    retryable: false,
  },
  {
    code: 'CATALOG_SCHEDULE_INVALID',
    test: (message) => /schedule.+(?:invalid|required|past)|start time.+(?:future|invalid|30 minutes)|end time.+(?:invalid|start)/i.test(message),
    userMessage: 'O horário de início ou término deixou de ser válido.',
    suggestedAction: 'Retome a criação; a dashboard recalculará o horário no fuso da conta.',
    retryable: true,
    safeAutomaticRetry: true,
  },
  {
    code: 'CATALOG_RATE_LIMITED',
    test: (message, error) => Number(error && error.status) === 429 || /rate limit|too many requests|requests? too frequently/i.test(message),
    userMessage: 'O TikTok limitou temporariamente as criações.',
    suggestedAction: 'A dashboard tentará novamente após o intervalo de segurança.',
    retryable: true,
    safeAutomaticRetry: true,
  },
  {
    code: 'CATALOG_TIKTOK_TEMPORARY',
    test: (message) => /could not acquire ip|try again later|service unavailable|temporar(?:y|ily)|internal server error/i.test(message),
    userMessage: 'O TikTok está temporariamente indisponível para esta criação.',
    suggestedAction: 'A dashboard tentará novamente sem reenviar o vídeo.',
    retryable: true,
    safeAutomaticRetry: true,
  },
  {
    code: 'CATALOG_CONNECTOR_UNAVAILABLE',
    test: (message, error) => Number(error && error.status) >= 500
      || /pipeboard mcp.+(?:tempo limite|falha de rede|http 5\d\d)|failed to fetch|network error|timeout|timed out/i.test(message),
    userMessage: 'A conexão com o TikTok ficou indisponível.',
    suggestedAction: 'A estrutura continua pausada. Tente novamente quando a conexão estabilizar.',
    retryable: true,
  },
]);

function classifyCatalogCreationError(value) {
  const error = value || {};
  const message = String(error.message || error || '');
  for (const rule of ERROR_RULES) {
    if (!rule.test(message, error)) continue;
    return {
      code: rule.code,
      userMessage: rule.userMessage,
      suggestedAction: rule.suggestedAction,
      retryable: rule.retryable,
      safeAutomaticRetry: rule.safeAutomaticRetry === true,
      providerRequestId: providerRequestId(error),
    };
  }
  return {
    providerRequestId: providerRequestId(error),
  };
}

module.exports = {
  MAX_CAMPAIGN_NAME_LENGTH,
  MAX_NAME_ATTEMPTS,
  normalizedNameKey,
  nextAvailableCampaignName,
  isCampaignNameConflict,
  providerRequestId,
  classifyCatalogCreationError,
};
