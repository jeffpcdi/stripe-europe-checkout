// Helpers de formatação unificados (bloco Z do plano de refinamento).
// Padrões do produto: pt-BR, moeda padrão BRL, fuso America/Sao_Paulo.

export const LOCALE = 'pt-BR'
export const TIMEZONE = 'America/Sao_Paulo'
export const DEFAULT_CURRENCY = 'BRL'

/* ── Moeda ─────────────────────────────────────────────────────────────── */

const currencyFmtCache = new Map<string, Intl.NumberFormat>()

/**
 * Formatação de moeda unificada (item 185): centavos → string pt-BR,
 * sempre 2 casas, arredondamento half-up (item 192).
 */
export function fmtCurrency(cents?: number | null, currency: string = DEFAULT_CURRENCY): string {
  const cur = (currency || DEFAULT_CURRENCY).toUpperCase()
  let fmt = currencyFmtCache.get(cur)
  if (!fmt) {
    fmt = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: cur,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    currencyFmtCache.set(cur, fmt)
  }
  // Math.round é half-up para valores positivos; para negativos usamos o simétrico.
  const v = cents || 0
  const rounded = v < 0 ? -Math.round(-v) : Math.round(v)
  return fmt.format(rounded / 100)
}

/**
 * Zero state com traço (item 189): distingue "sem dados" de zero real.
 * Passa `hasData=false` quando não houve nenhum registro no período.
 */
export function fmtCurrencyOrDash(
  cents: number | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  hasData = true,
): string {
  if (!hasData) return '—'
  return fmtCurrency(cents, currency)
}

/** Compat: assinatura antiga usada nos componentes (delegado ao fmtCurrency). */
export function formatMoney(cents?: number, currency: string = DEFAULT_CURRENCY): string {
  return fmtCurrency(cents, currency)
}

/* ── Números ───────────────────────────────────────────────────────────── */

const compactFmt = new Intl.NumberFormat(LOCALE, { notation: 'compact', maximumFractionDigits: 1 })
const intFmt = new Intl.NumberFormat(LOCALE)

/** Número compacto consistente (item 186): 1,2 mil / 3,4 mi. */
export function fmtCompact(n?: number | null): string {
  return compactFmt.format(n || 0)
}

/** Inteiro localizado com separador de milhar pt-BR. */
export function fmtInt(n?: number | null): string {
  return intFmt.format(Math.round(n || 0))
}

/** Percentual com 1 casa decimal fixa (item 187): "12,3%". */
export function fmtPercent(v?: number | null): string {
  return `${(v || 0).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
}

/**
 * Delta com sinal explícito (item 191): "+12,0%" / "−3,0%".
 * Usa o sinal de menos tipográfico (U+2212) para alinhamento mono.
 */
export function fmtDelta(pct?: number | null): string {
  const v = pct || 0
  const abs = Math.abs(v).toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  if (v > 0) return `+${abs}%`
  if (v < 0) return `\u2212${abs}%`
  return `0,0%`
}

/** Pluralização correta (item 193): plural(1,'venda') → "1 venda". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  const word = n === 1 ? singular : (pluralForm ?? `${singular}s`)
  return `${intFmt.format(n)} ${word}`
}

/* ── Datas e horas (fuso de Brasília) ──────────────────────────────────── */

const dateLongFmt = new Intl.DateTimeFormat(LOCALE, {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: TIMEZONE,
})

const timeFmt = new Intl.DateTimeFormat(LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: TIMEZONE,
})

const dateTimeFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: TIMEZONE,
})

/** Data por extenso PT (item 188): "qua., 8 de jul.". */
export function fmtDateLong(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? new Date(d) : d
  return dateLongFmt.format(date)
}

/** Hora local compacta (HH:MM:SS) no fuso de Brasília. */
export function formatTime(iso?: string): string {
  if (!iso) return ''
  try {
    return timeFmt.format(new Date(iso))
  } catch {
    return ''
  }
}

/** Data + hora local (dd/mm HH:MM) no fuso de Brasília. */
export function formatDateTime(iso?: string): string {
  if (!iso) return ''
  try {
    return dateTimeFmt.format(new Date(iso))
  } catch {
    return ''
  }
}

/** Tempo relativo compacto: "há 5min", "há 2h", "há 3d". */
export function timeAgo(iso?: string): string {
  if (!iso) return ''
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'agora'
  if (s < 3600) return `há ${Math.floor(s / 60)}min`
  if (s < 86400) return `há ${Math.floor(s / 3600)}h`
  return `há ${Math.floor(s / 86400)}d`
}

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  // en-CA gera YYYY-MM-DD — estável para comparar dias no fuso certo
  timeZone: TIMEZONE,
})

const dayShortFmt = new Intl.DateTimeFormat(LOCALE, {
  day: '2-digit',
  month: '2-digit',
  timeZone: TIMEZONE,
})

/** Rótulo de agrupamento por dia (item 151): "Hoje", "Ontem" ou "05/07". */
export function dayLabel(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    const key = dayKeyFmt.format(d)
    const today = dayKeyFmt.format(new Date())
    const yesterday = dayKeyFmt.format(new Date(Date.now() - 86_400_000))
    if (key === today) return 'Hoje'
    if (key === yesterday) return 'Ontem'
    return dayShortFmt.format(d)
  } catch {
    return ''
  }
}

/* ── Domínio (legado) ──────────────────────────────────────────────────── */

/** Bandeira emoji a partir do código ISO do país (ex.: "BR" → 🇧🇷) */
export function countryFlag(code?: string): string {
  if (!code || code.length !== 2) return '🌐'
  const base = 0x1f1e6
  const a = code.toUpperCase().charCodeAt(0) - 65
  const b = code.toUpperCase().charCodeAt(1) - 65
  if (a < 0 || a > 25 || b < 0 || b > 25) return '🌐'
  return String.fromCodePoint(base + a, base + b)
}

/** Rótulo amigável da página (pageLabel legado) */
export function pageLabel(p?: string): string {
  if (!p) return '—'
  const path = String(p).split('?')[0]
  if (path === '/' || path === '') return 'Página inicial'
  if (path.includes('checkout')) return 'Checkout'
  return path
}

/** Duração ao vivo compacta (liveDur legado): 45s, 3min, 2h */
export function liveDuration(ms?: number): string {
  const s = Math.floor((ms || 0) / 1000)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}min`
  return `${Math.floor(s / 3600)}h`
}

/** Visitante no checkout (isCheckoutLead legado) */
export function isCheckoutVisitor(page?: string): boolean {
  return !!(page && page.includes('checkout'))
}

/** Rótulo amigável do gateway (gwLabel legado): "link:oferta-es" → "Link oferta-es" */
export function gwLabel(g?: string | null): string {
  if (!g) return '—'
  if (g.startsWith('link:')) return `Link ${g.slice(5)}`
  return g.charAt(0).toUpperCase() + g.slice(1)
}
