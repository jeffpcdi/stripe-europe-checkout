// ── Mapa de erros da TikTok Events API → mensagens pt-BR amigáveis ─────────
// A API devolve códigos numéricos + mensagens em inglês técnico. Este módulo
// traduz os casos mais comuns para uma linguagem que o lojista entende e AGE.
// Fonte única: usado no teste de pixel, no log de disparos e no verify-url.
'use strict';

// Códigos documentados/observados da Events API (business-api.tiktok.com)
const CODIGOS = {
  0: null, // sucesso — sem tradução
  40001: 'Parâmetro inválido no evento — confira o Pixel Code e os dados enviados',
  40002: 'Pixel Code não encontrado — confira se copiou o código certo no TikTok Events Manager',
  40100: 'Access Token inválido ou expirado — gere um novo token no TikTok Events Manager e atualize aqui',
  40101: 'Access Token sem permissão para este pixel — confira se o token foi gerado para a conta de anúncio certa',
  40102: 'Access Token expirado — gere um novo no TikTok Events Manager',
  40105: 'Access Token revogado — gere um novo no TikTok Events Manager',
  50002: 'Instabilidade temporária do TikTok — tente de novo em alguns minutos'
};

// Padrões na mensagem em inglês → pt-BR (fallback quando o código não basta)
const PADROES = [
  [/access.?token.*(invalid|expired|not exist)/i, 'Access Token inválido ou expirado — gere um novo no TikTok Events Manager'],
  [/pixel.?code.*(invalid|not exist|not found)/i, 'Pixel Code não existe — confira o código no TikTok Events Manager'],
  [/event.?time.*(future|past|invalid)/i, 'Data/hora do evento fora da janela aceita pelo TikTok (máx. 7 dias no passado)'],
  [/no permission|permission denied/i, 'O token não tem permissão para este pixel — gere o token na conta de anúncio dona do pixel'],
  [/rate.?limit|too many/i, 'Limite de requisições do TikTok atingido — aguarde alguns minutos'],
  [/user.*(required|missing)|identifier/i, 'O evento precisa de ao menos um identificador de usuário (IP+navegador, e-mail ou ttclid)'],
  [/currency/i, 'Moeda inválida — use um código de 3 letras (BRL, USD, EUR…)'],
  [/timeout|timed out|network/i, 'O TikTok demorou para responder — o evento entra na fila de reenvio automático']
];

/**
 * Traduz um erro do TikTok para pt-BR amigável.
 * @param {number|string} code  código retornado pela Events API
 * @param {string} message      mensagem original (inglês)
 * @returns {string|null}       mensagem pt-BR, ou null quando não há erro
 */
function traduzErroTikTok(code, message) {
  const c = Number(code);
  if (c === 0) return null;
  if (CODIGOS[c]) return CODIGOS[c];
  const msg = String(message || '');
  for (const [re, ptbr] of PADROES) {
    if (re.test(msg)) return ptbr;
  }
  if (!msg) return 'Erro desconhecido do TikTok (código ' + (Number.isFinite(c) ? c : '?') + ')';
  // Sem tradução conhecida: devolve a original com prefixo, truncada
  return 'TikTok recusou o evento: ' + msg.slice(0, 160);
}

module.exports = { traduzErroTikTok };
