'use strict';

// ── notify-copy — copy humorada das notificações Web Push ──────────────────
// Usado SOMENTE pelo canal Web Push (o texto do Pushcut permanece intacto,
// inclusive o template custom de venda do item 429).
//
// build({ name, payload, meta, funMode, accountId }) → { title, body, url, tag }
//   - meta.event (quando presente) classifica com precisão: sale, failed,
//     refund, dispute, checkout, login, test. Vem do notifyPushcut/rotas.
//   - Sem meta, classifica pelo título do payload (prefixos estáveis:
//     "TikTok Ads:", "Resumo de", "Algo pode estar quebrado").
//   - funMode=false → copy sóbria (título/texto originais do payload).
//   - Anti-repetição: nunca sorteia a mesma frase duas vezes seguidas por
//     conta+evento (estado em memória; reinício zera, sem problema).

// Interpolação ESTRITA: {valor} {produto} {cliente} {gateway} {campanha}.
// Se o template referencia um dado que não veio, retorna null — o chamador
// usa o fallback (evita frases quebradas tipo "Checkout no em andamento").
function interp(tpl, data) {
  let missing = false;
  const out = String(tpl).replace(/\{(valor|produto|cliente|gateway|campanha)\}/g, (_, k) => {
    const v = data && data[k];
    if (v == null || !String(v).trim()) { missing = true; return ''; }
    return String(v).trim();
  }).replace(/\s{2,}/g, ' ').trim();
  return missing ? null : out;
}

// Pools de frases por evento. Cada item: { t: título, b: corpo }.
// Corpo vazio ('') = usa o texto original do payload (informação completa).
const POOLS = {
  sale: [
    // Completas (todos os dados)
    { t: '🤑 Venda Aprovada! {valor}', b: 'Produto: {produto}\nGateway: {gateway}\nCliente: {cliente}' },
    { t: '✅ Venda realizada com sucesso!', b: 'Você acaba de vender {produto} no valor de {valor}.' },
    { t: '🎉 Nova Venda Aprovada!', b: 'Valor: {valor} | Produto: {produto}' },
    // Médias (valor + produto/gateway)
    { t: '🤑 Comissão Recebida: {valor}', b: 'Produto: {produto} através do {gateway}.' },
    { t: '💰 Dinheiro na conta! {valor}', b: 'Sua venda de {produto} foi aprovada.' },
    { t: '✅ Mais uma venda! {valor}', b: '{produto} vendido no {gateway}.' },
    { t: '💳 Pagamento Aprovado', b: 'Valor: {valor}\nProduto: {produto}' },
    { t: '🚀 Venda Confirmada!', b: '{produto} foi vendido. Total: {valor}.' },
    { t: '🤑 {valor} em vendas!', b: 'O produto {produto} acabou de ser vendido.' },
    // Leves (só valor — sempre elegíveis quando há venda)
    { t: '🤑 Venda Aprovada! {valor}', b: 'O pagamento foi confirmado com sucesso.' },
    { t: '✅ Nova Venda: {valor}', b: 'Comissão adicionada ao seu saldo.' },
    { t: '💰 Saldo atualizado: +{valor}', b: 'Venda processada e aprovada no gateway.' },
    { t: '🎉 Pingou! {valor}', b: 'Mais uma venda aprovada pra conta.' }
  ],
  failed: [
    { t: '❌ Venda Recusada: {valor}', b: 'Produto: {produto} | Gateway: {gateway}\nMotivo: Pagamento negado pelo banco.' },
    { t: '⚠️ Cartão Recusado', b: 'A tentativa de compra de {produto} no valor de {valor} falhou.' },
    { t: '❌ Compra Não Autorizada', b: 'Valor: {valor} | Produto: {produto}\nRecuperação de carrinho sugerida.' },
    { t: '⚠️ Pagamento Cancelado: {valor}', b: 'O gateway barrou a transação de {produto}.' },
    { t: '❌ Venda Perdida', b: 'O banco recusou a compra de {valor} em {produto}.' },
    // Leves
    { t: '❌ Transação Recusada: {valor}', b: 'O cartão do cliente não foi autorizado.' },
    { t: '⚠️ Venda Não Aprovada', b: 'Uma transação de {valor} falhou no gateway.' },
    { t: '❌ Falha no Pagamento', b: 'Valor da tentativa: {valor}. Tente recuperar o cliente.' }
  ],
  refund: [
    { t: '💸 Reembolso Solicitado: {valor}', b: 'Produto: {produto} via {gateway}.' },
    { t: '⚠️ Reembolso Processado', b: 'O cliente pediu o estorno de {produto}. Valor: {valor}' },
    { t: '📉 Venda Estornada: {valor}', b: 'Reembolso confirmado no {gateway}.' },
    { t: '💸 Estorno Realizado', b: 'Valor de {valor} devolvido referente a {produto}.' },
    // Leves
    { t: '💸 Reembolso Confirmado: {valor}', b: 'O dinheiro foi devolvido ao cliente.' },
    { t: '⚠️ Estorno Aprovado', b: 'Um reembolso de {valor} foi finalizado.' }
  ],
  dispute: [
    { t: '🚨 Nova Disputa (Chargeback): {valor}', b: 'Produto: {produto} no {gateway}. Responda imediatamente.' },
    { t: '⚠️ Contestação Aberta: {valor}', b: 'O cliente contestou a compra de {produto}.' },
    { t: '🚨 Alerta de Chargeback: {valor}', b: 'Disputa iniciada no {gateway}. Reúna as provas de entrega.' },
    { t: '⚠️ Disputa Recebida', b: 'Transação de {produto} no valor de {valor} foi contestada.' },
    // Leves
    { t: '🚨 Disputa Aberta: {valor}', b: 'Chargeback iniciado. Envie suas provas ao gateway.' },
    { t: '⚠️ Notificação de Chargeback', b: 'Uma venda de {valor} sofreu contestação.' }
  ],
  checkout: [
    { t: '🛒 Checkout Iniciado', b: 'Alguém está prestes a comprar {produto} no {gateway}.' },
    { t: '👀 Novo Visitante no Checkout', b: 'Um cliente está no checkout do produto {produto}.' },
    { t: '🔥 Checkout Quente', b: 'Início de pagamento no {gateway}.' },
    // Leves (sem dados)
    { t: '🛒 Carrinho Ativo', b: 'Um cliente chegou na tela de pagamento.' },
    { t: '👀 Checkout Aberto', b: 'Falta pouco para mais uma venda.' },
    { t: '🔥 Processando Checkout', b: 'Aguardando o cliente finalizar a compra.' }
  ],
  login: [
    { t: 'Entraram no seu painel', b: 'Login novo na dashboard. Se foi você, relaxa. Se não foi... corre.' },
    { t: 'Alguém abriu a porta', b: 'Novo login no ROI-NADOS. Não reconhece? Troque a senha agora.' },
    { t: 'Login detectado', b: 'Acesso novo ao painel. Só confirmando que é você mesmo.' },
    { t: 'Toc toc — foi você?', b: 'Novo acesso ao painel. Se não foi, a senha nova te espera nas Configurações.' }
  ],
  daily: [
    { t: 'O resumão do dia chegou', b: '' },
    { t: 'Fechamento de caixa (spoiler abaixo)', b: '' },
    { t: 'Relatório diário: sem enrolação', b: '' },
    { t: 'Plantão ROI-NADOS: como foi o dia', b: '' },
    { t: 'Números do dia na área', b: '' }
  ],
  watchdog: [
    { t: 'Silêncio suspeito no caixa', b: '' },
    { t: 'Cadê as vendas?', b: '' },
    { t: 'O caixa tá quieto DEMAIS', b: '' }
  ],
  ads: [
    { t: 'TikTok Ads pedindo atenção', b: '' },
    { t: 'O motor de Ads te chamou', b: '' },
    { t: 'Novidade na área de Ads', b: '' },
    { t: 'Seu tráfego tem um recado', b: '' }
  ],
  ads_breaker: [
    { t: 'Circuit breaker acionado', b: 'Salvei seu orçamento de um incêndio. Motor pausado até a próxima varredura.' },
    { t: 'Freio de emergência puxado', b: 'Muitas falhas seguidas — o motor parou antes do estrago.' }
  ],
  ads_cap: [
    { t: 'Motor de Ads no limite', b: 'Teto de ações por hora atingido. Parei para evitar loop — seu dinheiro agradece.' },
    { t: 'Calma, motor!', b: 'Limite de ações/hora batido. Pausa estratégica ativada.' }
  ],
  test: [
    { t: 'Funcionou! (era um teste)', b: 'Se você está lendo isto no iPhone, as notificações nativas estão no ar. Pode comemorar.' },
    { t: 'Teste aprovado', b: 'O ROI-NADOS agora fala direto com seu bolso... digo, seu bolso do celular.' },
    { t: 'Alô, alô, testando', b: 'Notificação de teste entregue com sucesso. O canal tá aberto.' }
  ]
};

// Som por evento — tocado pelo painel ABERTO via WebAudio (sale-alerts.ts).
// Com o PWA fechado o iOS/Android tocam o som padrão do sistema (silent:false
// no sw.js); som customizado em background exigiria app nativo.
//   cash  = cha-ching (dinheiro entrando)
//   alert = dois tons graves descendentes (recusa/reembolso/disputa/watchdog)
//   tick  = click sutil agudo (checkout iniciado)
//   ping  = nota única limpa (login)
//   info  = tom médio suave (ads/resumo)
const SOUNDS = {
  sale: 'cash',
  test: 'cash',
  failed: 'alert',
  refund: 'alert',
  dispute: 'alert',
  watchdog: 'alert',
  checkout: 'tick',
  login: 'ping',
  daily: 'info',
  ads: 'info',
  ads_attention: 'info',
  ads_rejected: 'alert',
  ads_proposal: 'ping',
  ads_failure: 'alert',
  ads_breaker: 'info',
  ads_cap: 'info',
  ads_briefing: 'info',
  ads_routine: 'info'
};

// Agrupamento por tag: notificação com a MESMA tag substitui a anterior na
// tela de bloqueio. Eventos financeiros e de segurança EMPILHAM (tag única
// por notificação — você nunca perde uma venda porque outra chegou depois);
// eventos de status SUBSTITUEM (tag fixa — só a última importa, sem poluir).
const STACKED = new Set(['sale', 'failed', 'refund', 'dispute', 'login', 'ads_proposal', 'ads_failure']);
function tagFor(event) {
  const ev = event || 'geral';
  if (STACKED.has(ev)) return 'roinados-' + ev + '-' + Date.now().toString(36);
  return 'roinados-' + ev; // checkout, ads, daily, watchdog, test…
}

// Deep link por evento (basePath /dashboard já embutido)
const URLS = {
  sale: '/dashboard/activity',
  failed: '/dashboard/activity',
  refund: '/dashboard/activity',
  dispute: '/dashboard/activity',
  checkout: '/dashboard/activity',
  login: '/dashboard/config',
  daily: '/dashboard',
  watchdog: '/dashboard',
  ads: '/dashboard/ads/tiktok',
  ads_attention: '/dashboard/ads/tiktok',
  ads_rejected: '/dashboard/ads/tiktok',
  // A dashboard usa `tab=automation` (não o alias legado `view`). Esses
  // alertas são acionáveis; o deep link precisa abrir a superfície certa.
  ads_proposal: '/dashboard/ads/tiktok?tab=automation',
  ads_failure: '/dashboard/ads/tiktok?tab=automation',
  ads_breaker: '/dashboard/ads/tiktok',
  ads_cap: '/dashboard/ads/tiktok',
  ads_briefing: '/dashboard/ads/tiktok',
  ads_routine: '/dashboard/ads/tiktok?tab=automation',
  test: '/dashboard/config'
};

// Classificação sem meta: prefixos estáveis dos títulos existentes.
function classify(name, payload) {
  const title = String((payload || {}).title || '');
  if (/circuit breaker/i.test(title)) return 'ads_breaker';
  if (/limite de ações\/hora/i.test(title)) return 'ads_cap';
  if (/^TikTok Ads:/i.test(title)) return 'ads';
  if (/^Resumo de /i.test(title)) return 'daily';
  if (/^Algo pode estar quebrado/i.test(title)) return 'watchdog';
  if (name === 'Login') return 'login';
  return null; // desconhecido → passa o payload original
}

// Frase só é elegível se TODOS os dados que ela referencia estão presentes
// (título e corpo) — assim nunca sai texto com buraco.
function eligible(phrase, data) {
  return interp(phrase.t, data) !== null && (!phrase.b || interp(phrase.b, data) !== null);
}

// Anti-repetição: última frase usada por conta+evento (memória do processo).
const lastPick = new Map();
function pick(event, accountId, data) {
  const pool = (POOLS[event] || []).filter((ph) => eligible(ph, data));
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0];
  const key = (accountId || 'main') + ':' + event;
  const last = lastPick.get(key);
  let idx = Math.floor(Math.random() * pool.length);
  if (idx === last) idx = (idx + 1) % pool.length; // nunca repete a anterior
  lastPick.set(key, idx);
  return pool[idx];
}

/**
 * Monta a notificação Web Push (título/corpo/URL/tag) para um evento.
 * @param {object} opts { name, payload, meta, funMode, accountId }
 */
function build(opts) {
  const { name, payload, meta, funMode, accountId } = opts || {};
  const p = payload || {};
  const event = (meta && meta.event) || classify(name, p);
  const url = URLS[event] || '/dashboard';
  const tag = tagFor(event);
  // Som distinto por evento (mapa SOUNDS acima) — tocado pelo painel aberto
  // via WebAudio; no push fechado o sistema toca o som padrão.
  const sound = SOUNDS[event] || '';

  // Modo sóbrio ou evento desconhecido: título/texto originais.
  if (funMode === false || !event || !POOLS[event]) {
    return { title: p.title || 'ROI-NADOS', body: p.text || '', url, tag, sound, event: event || '' };
  }

  const data = meta || {};
  const phrase = pick(event, accountId, data);
  // Nenhuma frase elegível (faltam dados) → payload original, sem buracos.
  if (!phrase) return { title: p.title || 'ROI-NADOS', body: p.text || '', url, tag, sound, event };
  const title = interp(phrase.t, data) || p.title || 'ROI-NADOS';
  // Corpo vazio no pool ('') = usa o texto original (informação completa).
  const body = (phrase.b ? interp(phrase.b, data) : '') || p.text || '';
  return { title, body, url, tag, sound, event };
}

module.exports = { build, _pools: POOLS };
