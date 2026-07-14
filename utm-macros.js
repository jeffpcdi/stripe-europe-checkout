'use strict';

// ── Fase 1: sanitização de macros de UTM ──────────────────────────────────
// O TikTok só substitui as macros do anúncio (__CAMPAIGN_NAME__, __CAMPAIGN_ID__,
// __AID__, __PLACEMENT__…) na ENTREGA real. Cliques de preview do Ads Manager,
// bots e acessos diretos chegam com a macro literal não substituída e poluíam o
// ranking de campanhas.
//
// Regra: token ancorado em __MAIÚSCULAS/DÍGITOS__ (segmentos separados por _).
// Case-sensitive de propósito — nomes legítimos com underscore
// (promo_black_friday, verao_2024, até MINHA_CAMPANHA sem os __) NÃO casam; só o
// padrão de macro do TikTok. O `.test` casa a macro em qualquer posição da
// string (ex.: "utm__CAMPAIGN_NAME__") para não deixar passar valores colados.
const UTM_MACRO_RE = /__[A-Z0-9]+(?:_[A-Z0-9]+)*__/;

function isUtmMacro(v) {
  return typeof v === 'string' && UTM_MACRO_RE.test(v);
}

// Monta o objeto utm já sanitizado a partir dos 5 campos crus. Quando o campaign
// é uma macro não substituída, grava campaign=null e preserva o valor original em
// campaignRaw (auditoria — persiste junto do utm no lead, já que
// stats.recordVisit grava o objeto utm inteiro). Só campaign carrega macro.
function buildUtm(src) {
  src = src || {};
  const utm = {
    source: src.source || null,
    medium: src.medium || null,
    campaign: src.campaign || null,
    content: src.content || null,
    term: src.term || null,
  };
  if (isUtmMacro(utm.campaign)) {
    utm.campaignRaw = utm.campaign; // auditoria: macro crua não substituída
    utm.campaign = null;
  }
  return utm;
}

module.exports = { UTM_MACRO_RE, isUtmMacro, buildUtm };
