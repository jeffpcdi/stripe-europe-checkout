'use strict';

// Contratos de entrada compartilhados por todas as rotas de escrita do
// TikTok Ads. O provider continua sendo a última barreira, mas a API rejeita
// enums inválidos antes de criar qualquer recurso remoto.

const CAMPAIGN_GOALS = new Set([
  'engagement',
  'traffic',
  'awareness',
  'video_views',
  'lead_generation',
  'conversions',
]);

const SPARK_GOALS = new Set([
  'engagement',
  'traffic',
  'awareness',
  'video_views',
]);

const PIXEL_EVENTS = new Set([
  'ON_WEB_ORDER',
  'INITIATE_ORDER',
  'ON_WEB_CART',
  'ON_WEB_DETAIL',
  'ON_WEB_REGISTER',
  'LANDING_PAGE_VIEW',
]);

const CALL_TO_ACTIONS = new Set([
  'LEARN_MORE',
  'SHOP_NOW',
  'SIGN_UP',
  'DOWNLOAD_NOW',
  'CONTACT_US',
  'BOOK_NOW',
  'ORDER_NOW',
  'GET_QUOTE',
]);

const TIKTOK_MIN_BUDGET = 50;

module.exports = { CAMPAIGN_GOALS, SPARK_GOALS, PIXEL_EVENTS, CALL_TO_ACTIONS, TIKTOK_MIN_BUDGET };
