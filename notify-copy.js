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
    { t: 'KA-CHING! {valor} na conta', b: '{cliente} não resistiu: {produto} via {gateway}. O ROI tá nadando de costas.' },
    { t: 'Mais {valor}. Avisa o contador', b: '{produto} vendido no {gateway}. Segue o baile.' },
    { t: '{valor} caíram agora', b: 'Venda aprovada de {produto}. Dinheiro não dorme.' },
    { t: 'Cha-ching: {valor}', b: '{cliente} passou o cartão em {produto}. Bora comemorar (rapidinho).' },
    { t: 'Venda aprovada: {valor}', b: 'O {gateway} confirmou. {produto} entregue à causa.' },
    { t: '{valor} sem esforço', b: 'Mais uma de {produto} enquanto você fazia outra coisa.' },
    { t: 'O pix da felicidade: {valor}', b: '{cliente} comprou {produto}. A esteira segue rodando.' }
  ],
  failed: [
    { t: 'O cartão disse não: {valor}', b: 'Recusada em {produto} via {gateway}. Respira — recusada não é adeus.' },
    { t: '{valor} escaparam por pouco', b: 'Pagamento recusado no {gateway}. Acontece nas melhores famílias.' },
    { t: 'Recusada de {valor}', b: '{cliente} tentou, o banco negou. Quem sabe na segunda tentativa.' },
    { t: 'Quase, mas não: {valor}', b: 'O {gateway} barrou a compra de {produto}. Fica o aprendizado.' },
    { t: 'O banco tá de mau humor', b: 'Recusou {valor} em {produto}. Nada pessoal (será?).' }
  ],
  refund: [
    { t: 'Ihh, {valor} voltaram pro dono', b: 'Reembolso de {produto} via {gateway}. Acontece nas melhores famílias.' },
    { t: 'Reembolso de {valor}', b: '{cliente} pediu o dinheiro de volta. Deixa ir, o mar tá cheio de peixe.' },
    { t: '{valor} fizeram a viagem de volta', b: 'Reembolso processado no {gateway}. Bola pra frente.' },
    { t: 'Devolvemos {valor}', b: '{produto} não era pra ser. O próximo cliente vem aí.' }
  ],
  dispute: [
    { t: 'ALERTA: disputa de {valor}', b: 'Hora de vestir a toga e juntar as provas. {gateway} aguarda sua defesa.' },
    { t: 'Disputa aberta: {valor}', b: '{cliente} abriu contestação em {produto}. Documentos na mesa.' },
    { t: 'Chargeback à vista: {valor}', b: 'O {gateway} avisou. Quanto antes responder, melhor a taxa de vitória.' },
    { t: 'Alguém quer briga: {valor}', b: 'Disputa em {produto}. Mantenha a calma e o comprovante de entrega.' }
  ],
  checkout: [
    { t: 'Tem gente no caixa', b: 'Checkout iniciado no {gateway}. Torce pra não abandonar o carrinho.' },
    { t: 'Cliente na reta final', b: 'Alguém abriu o checkout de {produto}. Falta pouco.' },
    { t: 'Carrinho andando', b: 'Checkout no {gateway} em andamento. Sem pressão... mas converte.' }
  ],
  login: [
    { t: 'Entraram no seu painel', b: 'Login novo na dashboard. Se foi você, relaxa. Se não foi... corre.' },
    { t: 'Alguém abriu a porta', b: 'Novo login no ROI-NADOS. Não reconhece? Troque a senha agora.' },
    { t: 'Login detectado', b: 'Acesso novo ao painel. Só confirmando que é você mesmo.' }
  ],
  daily: [
    { t: 'O resumão do dia chegou', b: '' },
    { t: 'Fechamento de caixa (spoiler abaixo)', b: '' },
    { t: 'Relatório diário: sem enrolação', b: '' }
  ],
  watchdog: [
    { t: 'Silêncio suspeito no caixa', b: '' },
    { t: 'Cadê as vendas?', b: '' }
  ],
  ads: [
    { t: 'TikTok Ads pedindo atenção', b: '' },
    { t: 'O motor de Ads te chamou', b: '' },
    { t: 'Novidade na área de Ads', b: '' }
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
  ads_breaker: '/dashboard/ads/tiktok',
  ads_cap: '/dashboard/ads/tiktok',
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
  const tag = 'roinados-' + (event || 'geral');

  // Modo sóbrio ou evento desconhecido: título/texto originais.
  if (funMode === false || !event || !POOLS[event]) {
    return { title: p.title || 'ROI-NADOS', body: p.text || '', url, tag };
  }

  const data = meta || {};
  const phrase = pick(event, accountId, data);
  // Nenhuma frase elegível (faltam dados) → payload original, sem buracos.
  if (!phrase) return { title: p.title || 'ROI-NADOS', body: p.text || '', url, tag };
  const title = interp(phrase.t, data) || p.title || 'ROI-NADOS';
  // Corpo vazio no pool ('') = usa o texto original (informação completa).
  const body = (phrase.b ? interp(phrase.b, data) : '') || p.text || '';
  return { title, body, url, tag };
}

module.exports = { build, _pools: POOLS };
