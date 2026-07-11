'use client'

// Item 185: persistência de filtros/ordenação por aba. Drop-in de useState que
// espelha o valor em localStorage (chave prefixada) para o estado sobreviver à
// navegação entre abas e ao F5. NÃO usar para dados de negócio — apenas
// preferências de exibição (filtro, ordenação, aba ativa).
//
// SSR-safe: o primeiro render usa o default (mesmo HTML no servidor e no
// cliente); o valor salvo entra num efeito logo após a hidratação.
//
// Uso:  const [sortBy, setSortBy] = usePersistedState<SortKey>('links:sort', 'recentes')

import { useEffect, useRef, useState } from 'react'

const PREFIX = 'roi:ui:'

export function usePersistedState<T>(key: string, defaultValue: T) {
  const storageKey = PREFIX + key
  const [value, setValue] = useState<T>(defaultValue)
  const hydrated = useRef(false)

  // Carrega o valor salvo após a hidratação (evita mismatch SSR/cliente).
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey)
      if (raw !== null) setValue(JSON.parse(raw) as T)
    } catch {
      /* valor corrompido ou storage indisponível — mantém o default */
    }
    hydrated.current = true
  }, [storageKey])

  // Espelha toda mudança (pós-hidratação) no localStorage.
  useEffect(() => {
    if (!hydrated.current) return
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value))
    } catch {
      /* storage cheio/indisponível — segue só em memória */
    }
  }, [storageKey, value])

  return [value, setValue] as const
}
