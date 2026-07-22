// Datas de relatório do TikTok são dias civis no fuso da conta de anúncios.
// Nunca use toISOString() aqui: perto da meia-noite ele troca o dia em UTC e
// faz Visão geral e Campanhas consultarem janelas diferentes.

export const DEFAULT_ADS_TIME_ZONE = 'America/Sao_Paulo'

export function safeAdsTimeZone(timeZone?: string | null): string {
  const value = String(timeZone || '').trim()
  if (!value) return DEFAULT_ADS_TIME_ZONE
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: value }).format(new Date())
    return value
  } catch {
    return DEFAULT_ADS_TIME_ZONE
  }
}

export function adsDateKey(date: Date, timeZone?: string | null): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: safeAdsTimeZone(timeZone),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${value.year}-${value.month}-${value.day}`
}

export function adsDateRange(days: number, timeZone?: string | null, now = new Date()) {
  const count = Math.max(1, Math.floor(Number(days) || 1))
  const toDate = adsDateKey(now, timeZone)
  // Opera sobre a chave civil, não sobre o relógio local do navegador. Assim
  // subtrair um dia continua correto em qualquer fuso e em transições de DST.
  const [year, month, day] = toDate.split('-').map(Number)
  const from = new Date(Date.UTC(year, month - 1, day - (count - 1), 12))
  return { fromDate: adsDateKey(from, 'UTC'), toDate }
}
