'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Search, CornerDownLeft, PauseCircle, Filter, BarChart3, Loader2 } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'
import { apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'

type PaletteItem = {
  id: string
  label: string
  description: string
  href: string
  section: string
  icon: typeof Search
  kind: 'navigate' | 'filter_ads' | 'pause_bad'
}

/**
 * Item 87: command palette (Cmd+K / Ctrl+K) — busca rápida de páginas
 * com overlay glass, hover deslizante e navegação por teclado.
 */
export function CommandPalette() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [running, setRunning] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Atalho global Cmd+K / Ctrl+K
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = NAV_SECTIONS.flatMap((s) =>
      s.items.map((i) => ({ ...i, section: s.title, kind: 'navigate' as const })),
    )
    const q = query.trim().toLowerCase()
    if (!q) return all
    const matches = all.filter(
      (i) =>
        i.label.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q),
    )
    if (/pausar?.*(ruins?|sem venda)|campanhas?.*(ruins?|sem venda)/i.test(q)) {
      matches.unshift({
        id: 'command-pause-bad', label: 'Pausar campanhas ruins agora',
        description: 'Pausa ativas com gasto de hoje ≥ 100 e nenhuma venda atribuída.',
        href: '/ads/tiktok', section: 'Ação', icon: PauseCircle, kind: 'pause_bad' as const,
      })
    } else if (/campanhas?|gast|venderam|roas|ctr/i.test(q)) {
      matches.unshift({
        id: 'command-filter-ads', label: 'Filtrar campanhas com esta frase',
        description: 'Converte gasto, vendas, ROAS e status em filtros locais.',
        href: '/ads/tiktok', section: 'Filtro inteligente', icon: Filter, kind: 'filter_ads' as const,
      })
    }
    if (/receita.*hoje|vendas?.*hoje/i.test(q)) {
      matches.unshift({
        id: 'command-revenue-today', label: 'Ver receita de hoje',
        description: 'Abre a Visão geral no período de hoje.', href: '/',
        section: 'Atalho', icon: BarChart3, kind: 'navigate' as const,
      })
    }
    return matches
  }, [query])

  // Reset ao abrir
  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
    }
  }, [open])

  const go = useCallback(
    (href: string) => {
      setOpen(false)
      router.push(href)
    },
    [router],
  )

  const runItem = useCallback(async (item: PaletteItem) => {
    if (item.kind === 'filter_ads') {
      localStorage.setItem('roi_ads_natural_filter', query.trim())
      window.dispatchEvent(new CustomEvent('roi:ads-filter', { detail: query.trim() }))
      go(item.href)
      return
    }
    if (item.kind === 'pause_bad') {
      setRunning(true)
      try {
        const result = await apiSend<{ paused: number; matched: number; dryRun?: boolean }>('/api/ads/commands', 'POST', {
          command: 'pause_bad_campaigns', minimumSpend: 100,
        })
        setOpen(false)
        toast.success(result.dryRun ? 'Simulação concluída' : `${result.paused} campanha(s) pausada(s)`, {
          hint: result.dryRun ? `${result.matched} campanha(s) seriam pausadas no modo real.` : 'Critério: gasto de hoje ≥ 100 e zero vendas atribuídas.',
        })
      } catch (error) {
        toast.error('Não foi possível executar o comando', { hint: error instanceof Error ? error.message : undefined })
      } finally {
        setRunning(false)
      }
      return
    }
    go(item.href)
  }, [go, query])

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter' && items[active]) {
      e.preventDefault()
      void runItem(items[active])
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px]"
          style={{ animation: 'popBgIn var(--dur-fast) var(--ease) both' }}
        />
        {/* V2-79: palette com contorno gradiente ciano→rosa (border-gradient)
            + V2-80: ícone de busca respira enquanto aguarda digitação */}
        <Dialog.Content
          className="glass glass-thick anim-pop-in border-gradient fixed left-1/2 top-[12%] z-50 w-[calc(100vw-2rem)] max-w-md -translate-x-1/2 overflow-hidden p-0 focus:outline-none"
          aria-describedby={undefined}
        >
          <Dialog.Title className="sr-only">Busca rápida</Dialog.Title>
          <div className="flex items-center gap-2.5 border-b border-border/60 px-4 py-3">
            <Search
              className={cn('size-4 shrink-0 text-muted-foreground', !query && 'anim-breathe')}
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              onKeyDown={onInputKey}
              placeholder="Digite uma ação ou pergunta…"
              className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              aria-label="Buscar página"
            />
            <kbd className="hidden rounded border border-border/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:block">
              esc
            </kbd>
          </div>
          <ul className="max-h-72 overflow-y-auto p-1.5" role="listbox">
            {items.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-muted-foreground">
                Nada encontrado para &quot;{query}&quot;
              </li>
            ) : (
              items.map((item, i) => (
                <li key={item.id} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    data-active={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => void runItem(item)}
                    disabled={running}
                    className="cmdk-item flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left"
                  >
                    {running && i === active ? <Loader2 className="size-4 shrink-0 animate-spin text-brand-cyan" aria-hidden="true" /> : <item.icon
                      className={cn(
                        'size-4 shrink-0',
                        i === active ? 'text-brand-cyan' : 'text-muted-foreground',
                      )}
                      aria-hidden="true"
                    />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm text-foreground">{item.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {item.description}
                      </span>
                    </span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-faint">
                      {item.section}
                    </span>
                    {i === active && (
                      <CornerDownLeft className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
