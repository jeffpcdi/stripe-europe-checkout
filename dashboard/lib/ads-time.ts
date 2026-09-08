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

/** Janela anterior com o mesmo número de dias civis, inclusive em mudanças de fuso. */
export function previousAdsRange(range: { fromDate: string; toDate: string }) {
  const from = Date.parse(`${range.fromDate}T12:00:00Z`)
  const to = Date.parse(`${range.toDate}T12:00:00Z`)
  const length = Math.round((to - from) / 864e5) + 1
  return {
    fromDate: adsDateKey(new Date(from - length * 864e5), 'UTC'),
    toDate: adsDateKey(new Date(from - 864e5), 'UTC'),
  }
}

export function shiftAdsDay(day: string, days: number) {
  return adsDateKey(new Date(Date.parse(`${day.slice(0, 10)}T12:00:00Z`) + days * 864e5), 'UTC')
}
