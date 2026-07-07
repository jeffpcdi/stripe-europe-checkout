'use client'

import { useState } from 'react'
import { Plus, Link2, Copy, Check, Pencil, Trash2, Smartphone, MousePointerClick } from 'lucide-react'
import { useCloakEntries, apiSend } from '@/lib/api'
import type { CloakEntry } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { CloakEntryEditor } from './cloak-entry-editor'

export function CloakEntriesPanel() {
  const { data, mutate } = useCloakEntries()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<CloakEntry | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  const entries = data?.entries ?? []
  const baseUrl = data?.baseUrl ?? ''

  function urlFor(e: CloakEntry) {
    const base = e.dominio ? `https://${e.dominio}` : baseUrl
    return `${base}/c/${e.slug}`
  }

  function handleCopy(e: CloakEntry) {
    navigator.clipboard.writeText(urlFor(e)).then(() => {
      setCopied(e.slug)
      setTimeout(() => setCopied(null), 2000)
    })
  }

  async function handleDelete(e: CloakEntry) {
    if (!window.confirm(`Remover o link de cloaking "${e.nome}"?`)) return
    await apiSend(`/api/cloak/entries/${encodeURIComponent(e.slug)}`, 'DELETE')
    mutate()
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Links de cloaking</h2>
          <p className="text-xs text-muted-foreground">URLs /c/&lt;slug&gt; com proteção própria e slug aleatório</p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90"
        >
          <Plus className="size-3.5" /> Novo link
        </button>
      </div>

      {entries.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum link de cloaking. Crie um para proteger uma offer com página branca própria.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.slug} className="rounded-xl border border-border bg-secondary/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className={`size-2 shrink-0 rounded-full ${e.enabled ? 'bg-success' : 'bg-muted-foreground'}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{e.nome}</p>
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{urlFor(e)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {e.mobileOnly && (
                    <StatusBadge status="info">
                      <Smartphone className="size-3" /> mobile
                    </StatusBadge>
                  )}
                  {e.requireAdClick && (
                    <StatusBadge status="info">
                      <MousePointerClick className="size-3" /> ad-click
                    </StatusBadge>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <Link2 className="size-3 shrink-0" />
                <span className="truncate text-success">→ {e.offerUrl}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => handleCopy(e)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
                >
                  {copied === e.slug ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                  {copied === e.slug ? 'Copiado' : 'Copiar URL'}
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(e)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <Pencil className="size-3.5" /> Editar
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(e)}
                  className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(creating || editing) && (
        <CloakEntryEditor
          entry={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            mutate()
          }}
        />
      )}
    </GlassCard>
  )
}
