// Dicionário pt-BR dos sinais do cloaker (bot-filter.js).
// Cada sinal vem no formato "prefixo:detalhe" — traduzimos o prefixo e
// indicamos se o sinal AUMENTA a suspeita (bot) ou indica humano real.

export interface SignalInfo {
  label: string
  kind: 'suspeito' | 'confiavel' | 'neutro'
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

const TRUST_PREFIXES = ['tz:ok', 'timing:normal', 'webview:ok', 'ent:humano']

const LABELS: Record<string, string> = {
  'ua:tiktok-inapp': 'navegador interno do TikTok (tráfego real)',
  'ua:ausente': 'sem identificação de navegador',
  'ua:headless': 'navegador automatizado (headless)',
  'ch-ua:brand-mismatch': 'marca do navegador não bate com a identificação',
  'ch-ua:safari-chrome-mix': 'mistura impossível de Safari com Chrome',
  'ch-ua:mobile-mismatch': 'diz ser celular mas os dados são de desktop',
  'ch-ua:ausente-chrome-novo': 'Chrome novo sem os cabeçalhos esperados',
  'ch-ua:presente': 'cabeçalhos do navegador consistentes',
  'headers:missing': 'faltam cabeçalhos que todo navegador envia',
  'accept:sem-html': 'não aceita HTML (típico de robô)',
  'sec-fetch:ausente': 'sem cabeçalhos de navegação segura',
  'sec-fetch:ok': 'cabeçalhos de navegação corretos',
  'referer:ausente': 'chegou sem página de origem',
  'referer:tiktok': 'veio do TikTok',
  'referer:social-legit': 'veio de rede social conhecida',
  'ip:bytedance-cidr': 'IP da rede da ByteDance (revisor do TikTok)',
  'asn:deadline': 'consulta de operadora expirou',
  'asn:datacenter': 'IP de data center (não é conexão residencial)',
  'asn:carrier': 'IP de operadora de celular',
  'js:token-ok': 'desafio JavaScript resolvido (navegador real)',
  'js:token-fail': 'falhou no desafio JavaScript',
  'js:sem-token': 'não executou JavaScript',
  'webgl:software-renderer': 'placa de vídeo emulada por software',
  'webgl:gpu-real': 'placa de vídeo real detectada',
  'webgl:angle': 'renderização padrão do Chrome',
  'tz:mismatch': 'fuso horário não bate com o país do IP',
  'tz:ok': 'fuso horário coerente com o IP',
  'canvas:sem-render': 'tela não renderizou conteúdo gráfico',
  'timing:muito-rapido': 'ação rápida demais para ser humana',
  'timing:muito-lento': 'demora atípica na resposta',
  'timing:normal': 'tempo de resposta humano',
  'beh:zero-interacao': 'nenhum toque, clique ou rolagem',
  'beh:interacao-real': 'interação humana detectada',
  'beh:baixo': 'pouca interação com a página',
  'webview:ua-spoof': 'finge ser app mas não é',
  'webview:ok': 'app nativo confirmado',
  'webview:chrome-runtime-inapp': 'runtime de Chrome dentro de app (incoerente)',
  'coh:apple-ua-nonapple-gpu': 'diz ser iPhone mas a GPU não é da Apple',
  'coh:plat-mismatch': 'sistema operacional não bate com o navegador',
  'coh:mobile-cpu-alto': 'CPU forte demais para o celular informado',
  'coh:mobile-ram-alta': 'memória alta demais para o celular informado',
  'coh:mobile-sem-touch': 'celular sem tela de toque (impossível)',
  'coh:mobile-tela-desktop': 'diz ser celular com tela de desktop',
  'coh:lang-fora-geo': 'idioma do navegador não bate com o país',
  'ent:movimento-sintetico': 'movimento de mouse robótico',
  'ent:humano': 'micro-movimentos humanos reais',
  'ent:acao-sem-trilha': 'clicou sem mover o mouse antes',
  'lang:zh-fora-geo': 'navegador em chinês fora da China',
  'lang:sem-quality-factor': 'configuração de idioma atípica',
}

export function describeSignal(raw: string): SignalInfo {
  // separa "prefixo:chave=detalhe" → busca por "prefixo:chave"
  const base = raw.split('=')[0]
  const label = LABELS[base] || raw
  let kind: SignalInfo['kind'] = 'neutro'
  if (TRUST_KEYS.has(base) || TRUST_PREFIXES.some((p) => base === p)) kind = 'confiavel'
  else if (LABELS[base]) kind = 'suspeito'
  // sinais informativos que não pesam contra
  if (base === 'asn:carrier' || base === 'beh:baixo' || base === 'asn:deadline' || base === 'headers:missing')
    kind = base === 'headers:missing' ? 'suspeito' : 'neutro'
  return { label, kind }
}
