/* Preferências de SOM das notificações — por aparelho (localStorage).
   O push em si (canal servidor) é controlado por webPush.events no config da
   conta; aqui é só o som local tocado com o painel aberto (push-sound.tsx).

   Grupos de evento espelham o servidor (server.js EVENT_GROUPS):
   sale, failed, refund, dispute, checkout, login, ads, system.            */

const KEY = 'roi-sound-prefs'

/** Grupos de evento com som configurável (mesma taxonomia do servidor). */
export const SOUND_GROUPS = [
  'sale',
  'failed',
  'refund',
  'dispute',
  'checkout',
  'login',
  'ads',
  'system',
] as const

export type SoundGroup = (typeof SOUND_GROUPS)[number]

/** Evento do push (notify-copy) → grupo de preferência. */
export function eventToGroup(event: string): SoundGroup {
  switch (event) {
    case 'sale':
    case 'test':
      return 'sale'
    case 'failed':
      return 'failed'
    case 'refund':
      return 'refund'
    case 'dispute':
      return 'dispute'
    case 'checkout':
      return 'checkout'
    case 'login':
      return 'login'
    case 'ads':
    case 'ads_breaker':
    case 'ads_cap':
      return 'ads'
    default:
      // daily, watchdog e desconhecidos caem em "system"
      return 'system'
  }
}

export type SoundPrefs = Record<SoundGroup, boolean>

const DEFAULTS: SoundPrefs = {
  sale: true,
  failed: true,
  refund: true,
  dispute: true,
  checkout: true,
  login: true,
  ads: true,
  system: true,
}

export function getSoundPrefs(): SoundPrefs {
  if (typeof window === 'undefined') return { ...DEFAULTS }
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<SoundPrefs>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setSoundPref(group: SoundGroup, enabled: boolean) {
  if (typeof window === 'undefined') return
  try {
    const prefs = getSoundPrefs()
    prefs[group] = enabled
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // storage cheio/indisponível: falha em silêncio
  }
}

/** true se o som deste evento está habilitado neste aparelho. */
export function isSoundEnabled(event: string): boolean {
  return getSoundPrefs()[eventToGroup(event)]
}
