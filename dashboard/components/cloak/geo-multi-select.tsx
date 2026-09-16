'use client'

import { useMemo, useRef, useState } from 'react'
import { Search, X, Plus } from 'lucide-react'
import type { GeoOption } from '@/lib/geo-options'

interface Props {
  value: string[]
  onChange: (next: string[]) => void
  options: GeoOption[]
  normalize: (raw: string) => string
  labelFor: (code: string) => string
  emptyLabel: string
  placeholder: string
  manualPattern: RegExp
  id?: string
  flags?: boolean
}

function flagEmoji(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return ''
  return code
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
}

export function GeoMultiSelect({
  value,
  onChange,
  options,
  normalize,
  labelFor,
  emptyLabel,
  placeholder,
  manualPattern,
  id,
  flags = false,
}: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const selected = value.map((c) => normalize(c))
  const q = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    return options
      .filter((o) => !selected.includes(normalize(o.code)))
      .filter((o) => !q || o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      .slice(0, 40)
  }, [options, selected, q, normalize])

  const manualCode = normalize(query.trim())
  const canAddManual =
    !!query.trim() &&
    manualPattern.test(query.trim()) &&
    !selected.includes(manualCode) &&
    !options.some((o) => normalize(o.code) === manualCode)

  function add(code: string) {
    const c = normalize(code)
    if (!c || selected.includes(c)) return
    onChange([...value, c])
    setQuery('')
    inputRef.current?.focus()
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData('text')
    const tokens = text
      .split(/[,;\n\r\t ]+/)
      .map((t) => t.trim())
      .filter(Boolean)
    if (tokens.length < 2) return
    e.preventDefault()
    const next = [...value]
    const seen = new Set(next.map((v) => normalize(v)))
    for (const t of tokens) {
      if (!manualPattern.test(t)) continue
      const c = normalize(t)
      if (c && !seen.has(c)) {
        seen.add(c)
        next.push(c)
      }
    }
    onChange(next)
    setQuery('')
  }

  function remove(code: string) {
    const c = normalize(code)
    onChange(value.filter((v) => normalize(v) !== c))
  }

  return (
    <div className="relative">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {selected.length === 0 ? (
          <span className="text-xs text-muted-foreground">{emptyLabel}</span>
        ) : (
          selected.map((code) => (
            <span
              key={code}
              className="flex items-center gap-1.5 rounded-md border border-border/70 bg-secondary/35 px-2 py-1.5 text-xs font-medium text-foreground"
            >
              {flags && flagEmoji(code) ? <span aria-hidden="true">{flagEmoji(code)}</span> : null}
              <span>{labelFor(code)}</span>
              <span className="font-mono text-xs text-muted-foreground">{code}</span>
              <button
                type="button"
                onClick={() => remove(code)}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20"
                aria-label={`Remover ${labelFor(code)}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          id={id}
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onPaste={handlePaste}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (filtered.length) add(filtered[0].code)
              else if (canAddManual) add(query.trim())
            }
          }}
          placeholder={placeholder}
          className="h-11 w-full rounded-lg border border-border bg-secondary/35 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none focus:ring-2 focus:ring-brand-cyan/10"
        />
      </div>

      {open && (query || filtered.length > 0) && (
        <div className="absolute z-10 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-border bg-card p-1 shadow-lg">
          {filtered.map((o) => (
            <button
              key={o.code}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(o.code)}
              className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-secondary"
            >
              <span className="min-w-0 truncate">
                {flags && flagEmoji(o.code) ? <span className="mr-1.5" aria-hidden="true">{flagEmoji(o.code)}</span> : null}
                {o.name}
              </span>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.code}</span>
            </button>
          ))}
          {canAddManual && (
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(query.trim())}
              className="flex min-h-10 w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
            >
              <Plus className="size-3.5" />
              Adicionar código <span className="font-mono">{manualCode}</span>
            </button>
          )}
          {!filtered.length && !canAddManual && (
            <p className="px-2.5 py-3 text-center text-xs text-muted-foreground">Nenhum resultado</p>
          )}
        </div>
      )}
    </div>
  )
}
