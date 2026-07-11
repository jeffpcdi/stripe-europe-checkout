// Dicionário pt-BR dos sinais do cloaker (bot-filter.js).
// Cada sinal vem no formato "prefixo:detalhe" — traduzimos o prefixo, indicamos
// se AUMENTA a suspeita (bot) ou indica humano real, agrupamos por CAMADA de
// detecção (itens 161/204/205/206) e trazemos o peso aproximado no score
// (item 161 — espelha os pesos de bot-filter.js).

export type SignalLayer = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H'

export interface SignalInfo {
  label: string
  kind: 'suspeito' | 'confiavel' | 'neutro'
  layer: SignalLayer
  weight: number // peso no score (positivo = mais bot; negativo = mais real)
}

// Metadados de cada camada — usados para agrupar os sinais na UI de teste.
export const LAYER_META: Record<SignalLayer, { label: string; hint: string }> = {
  A: { label: 'A · Navegador (UA)', hint: 'identificação do navegador e app in-app' },
  B: { label: 'B · Cabeçalhos', hint: 'Client Hints, Sec-Fetch, referer' },
  C: { label: 'C · Rede / ASN', hint: 'operadora vs data center do IP' },
  D: { label: 'D · Desafio JS', hint: 'token, WebGL, timezone, canvas' },
  E: { label: 'E · Idioma', hint: 'accept-language vs geo' },
  F: { label: 'F · Webview', hint: 'integridade do app nativo' },
  G: { label: 'G · Coerência', hint: 'plataforma/hardware x UA/geo' },
  H: { label: 'H · Comportamento', hint: 'mouse, toque, timing, entropia' },
}

// Sinais que REDUZEM o score (indicam tráfego real)
const TRUST_KEYS = new Set([
  'ua:tiktok-inapp',
  'sec-fetch:ok',
  'ch-ua:presente',
  'referer:tiktok',
  'referer:social-legit',
  'js:token-ok',
  'webgl:gpu-real',
  'webgl:angle',
  'beh:interacao-real',
])

const TRUST_PREFIXES = ['tz:ok', 'timing:normal', 'webview:ok', 'ent:humano', 'asn:carrier']

// label + camada + peso aproximado por sinal (peso extraído de bot-filter.js)
const META: Record<string, { label: string; layer: SignalLayer; weight: number }> = {
  'ua:tiktok-inapp': { label: 'navegador interno do TikTok (tráfego real)', layer: 'A', weight: -40 },
  'ua:ausente': { label: 'sem identificação de navegador', layer: 'A', weight: 55 },
  'ua:headless': { label: 'navegador automatizado (headless)', layer: 'A', weight: 50 },
  'ch-ua:brand-mismatch': { label: 'marca do navegador não bate com a identificação', layer: 'B', weight: 30 },
  'ch-ua:safari-chrome-mix': { label: 'mistura impossível de Safari com Chrome', layer: 'B', weight: 25 },
  'ch-ua:mobile-mismatch': { label: 'diz ser celular mas os dados são de desktop', layer: 'B', weight: 20 },
  'ch-ua:ausente-chrome-novo': { label: 'Chrome novo sem os cabeçalhos esperados', layer: 'B', weight: 18 },
  'ch-ua:presente': { label: 'cabeçalhos do navegador consistentes', layer: 'B', weight: -10 },
  'headers:missing': { label: 'faltam cabeçalhos que todo navegador envia', layer: 'B', weight: 15 },
  'accept:sem-html': { label: 'não aceita HTML (típico de robô)', layer: 'B', weight: 15 },
  'sec-fetch:ausente': { label: 'sem cabeçalhos de navegação segura', layer: 'B', weight: 22 },
  'sec-fetch:ok': { label: 'cabeçalhos de navegação corretos', layer: 'B', weight: -12 },
  'referer:ausente': { label: 'chegou sem página de origem', layer: 'B', weight: 8 },
  'referer:tiktok': { label: 'veio do TikTok', layer: 'B', weight: -15 },
  'referer:social-legit': { label: 'veio de rede social conhecida', layer: 'B', weight: -8 },
  'ip:bytedance-cidr': { label: 'IP da rede da ByteDance (revisor do TikTok)', layer: 'C', weight: 50 },
  'asn:deadline': { label: 'consulta de operadora expirou (resolve na próxima visita)', layer: 'C', weight: 0 },
  'asn:datacenter': { label: 'IP de data center (não é conexão residencial)', layer: 'C', weight: 38 },
  'asn:carrier': { label: 'IP de operadora de celular (real)', layer: 'C', weight: -10 },
  'js:token-ok': { label: 'desafio JavaScript resolvido (navegador real)', layer: 'D', weight: -28 },
  'js:token-fail': { label: 'falhou no desafio JavaScript', layer: 'D', weight: 22 },
  'js:sem-token': { label: 'não executou JavaScript', layer: 'D', weight: 12 },
  'webgl:software-renderer': { label: 'placa de vídeo emulada por software', layer: 'D', weight: 45 },
  'webgl:gpu-real': { label: 'placa de vídeo real detectada', layer: 'D', weight: -18 },
  'webgl:angle': { label: 'renderização padrão do Chrome', layer: 'D', weight: -8 },
  'tz:mismatch': { label: 'fuso horário não bate com o país do IP', layer: 'D', weight: 15 },
  'tz:ok': { label: 'fuso horário coerente com o IP', layer: 'D', weight: -8 },
  'canvas:sem-render': { label: 'tela não renderizou conteúdo gráfico', layer: 'D', weight: 20 },
  'timing:muito-rapido': { label: 'ação rápida demais para ser humana', layer: 'H', weight: 20 },
  'timing:muito-lento': { label: 'demora atípica na resposta', layer: 'H', weight: 12 },
  'timing:normal': { label: 'tempo de resposta humano', layer: 'H', weight: -5 },
  'beh:zero-interacao': { label: 'nenhum toque, clique ou rolagem', layer: 'H', weight: 25 },
  'beh:interacao-real': { label: 'interação humana detectada', layer: 'H', weight: -20 },
  'beh:baixo': { label: 'pouca interação com a página', layer: 'H', weight: 0 },
  'webview:ua-spoof': { label: 'finge ser app mas não é', layer: 'F', weight: 45 },
  'webview:ok': { label: 'app nativo confirmado', layer: 'F', weight: -15 },
  'webview:chrome-runtime-inapp': { label: 'runtime de Chrome dentro de app (incoerente)', layer: 'F', weight: 22 },
  'coh:apple-ua-nonapple-gpu': { label: 'diz ser iPhone mas a GPU não é da Apple', layer: 'G', weight: 28 },
  'coh:plat-mismatch': { label: 'sistema operacional não bate com o navegador', layer: 'G', weight: 30 },
  'coh:mobile-cpu-alto': { label: 'CPU forte demais para o celular informado', layer: 'G', weight: 18 },
  'coh:mobile-ram-alta': { label: 'memória alta demais para o celular informado', layer: 'G', weight: 14 },
  'coh:mobile-sem-touch': { label: 'celular sem tela de toque (impossível)', layer: 'G', weight: 16 },
  'coh:mobile-tela-desktop': { label: 'diz ser celular com tela de desktop', layer: 'G', weight: 14 },
  'coh:lang-fora-geo': { label: 'idioma do navegador não bate com o país', layer: 'G', weight: 12 },
  'ent:movimento-sintetico': { label: 'movimento de mouse robótico', layer: 'H', weight: 20 },
  'ent:humano': { label: 'micro-movimentos humanos reais', layer: 'H', weight: -10 },
  'ent:acao-sem-trilha': { label: 'clicou sem mover o mouse antes', layer: 'H', weight: 22 },
  'lang:zh-fora-geo': { label: 'navegador em chinês fora da China', layer: 'E', weight: 22 },
  'lang:sem-quality-factor': { label: 'configuração de idioma atípica', layer: 'E', weight: 8 },
}

export function describeSignal(raw: string): SignalInfo {
  // separa "prefixo:chave=detalhe" → busca por "prefixo:chave"
  const base = raw.split('=')[0]
  const meta = META[base]
  const label = meta?.label || raw
  let kind: SignalInfo['kind'] = 'neutro'
  if (TRUST_KEYS.has(base) || TRUST_PREFIXES.some((p) => base === p)) kind = 'confiavel'
  else if (meta) kind = 'suspeito'
  // sinais informativos que não pesam contra
  if (base === 'beh:baixo' || base === 'asn:deadline') kind = 'neutro'
  if (base === 'headers:missing') kind = 'suspeito'
  return { label, kind, layer: meta?.layer ?? 'A', weight: meta?.weight ?? 0 }
}
