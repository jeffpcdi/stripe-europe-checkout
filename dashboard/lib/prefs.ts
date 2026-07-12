'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Preferências visuais do usuário (bloco S — itens 121, 122, 125).
 * Persistidas em localStorage e aplicadas como data-attributes no <html>,
 * onde o globals.css as consome.
 */

const STORAGE_KEY = 'roi:prefs'

export interface Prefs {
  /** Item 121: densidade dos cards/tabelas */
  density: 'comfortable' | 'compact'
  /** Item 122: reduzir animações independentemente do SO */
  anim: 'on' | 'off'
  /** Item 125: modo apresentação — borra valores sensíveis */
  privacy: 'off' | 'on'
  /** Item 390: relógio do header com segundos (clique no relógio alterna) */
  clockSeconds: 'off' | 'on'
}

const DEFAULTS: Prefs = { density: 'comfortable', anim: 'on', privacy: 'off', clockSeconds: 'off' }

function load(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

function apply(prefs: Prefs) {
  const el = document.documentElement
  el.dataset.density = prefs.density
  el.dataset.anim = prefs.anim
  el.dataset.privacy = prefs.privacy
}

/** Evento interno para sincronizar múltiplos consumidores do hook na mesma aba */
const PREFS_EVENT = 'roi:prefs-changed'

export function usePrefs() {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULTS)

  useEffect(() => {
    const initial = load()
    setPrefs(initial)
    apply(initial)
    function onChange() {
      setPrefs(load())
    }
    window.addEventListener(PREFS_EVENT, onChange)
    window.addEventListener('storage', onChange)
    return () => {
      window.removeEventListener(PREFS_EVENT, onChange)
      window.removeEventListener('storage', onChange)
    }
  }, [])

  const update = useCallback((patch: Partial<Prefs>) => {
    const next = { ...load(), ...patch }
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* localStorage indisponível — aplica só na sessão */
    }
    apply(next)
    setPrefs(next)
    window.dispatchEvent(new Event(PREFS_EVENT))
  }, [])

  return { prefs, update }
}
