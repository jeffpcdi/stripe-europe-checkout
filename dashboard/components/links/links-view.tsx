'use client'

import { useState } from 'react'
import { Link2, Plus, Copy, Check, Pencil, Trash2, Globe, Languages } from 'lucide-react'
import { useLinks, useDomains, apiSend } from '@/lib/api'
import type { CheckoutLink } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { LinkEditor } from './link-editor'

export function LinksView() {
  const { data, isLoading, mutate } = useLinks()
  const { data: domainsData } = useDomains()
  const [editing, setEditing] = useState<CheckoutLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const appHost = domainsData?.appHost ?? ''
  const links = data?.links ?? []

  function publicUrl(l: CheckoutLink) {
    const host = l.dominio || appHost
    return `https://${host}/go/${l.slug}`
  }

  async function copyUrl(l: CheckoutLink) {
    await navigator.clipboard.writeText(publicUrl(l))
    setCopied(l.slug)
    setTimeout(() => setCopied(null), 1500)
  }

  async function handleDelete(slug: string) {
    await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
    setDeleting(null)
    mutate()
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {links.length} link{links.length === 1 ? '' : 's'} de checkout
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
        >
          <Plus className="size-4" /> Novo link
        </button>
      </div>

      {links.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Link2 className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-pretty">
            Nenhum link ainda. Crie um link /go/slug com split A/B, cloak e domínio próprio.
          </p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((l) => {
            const clicks = l.variantes.reduce((s, v) => s + v.clicks, 0)
            const convs = l.variantes.reduce((s, v) => s + v.conversions, 0)
            return (
              <GlassCard key={l.slug} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{l.nome}</h3>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          l.ativo
                            ? 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
                            : 'bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        {l.ativo ? 'Ativo' : 'Pausado'}
                      </span>
                      {l.urlWhitePage && (
                        <span className="rounded-md bg-[color:var(--brand-pink)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--brand-pink)]">
                          Cloak
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      {publicUrl(l)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {l.variantes.length} variante{l.variantes.length === 1 ? '' : 's'}
                      </span>
                      <span className="tabular-nums">{clicks} cliques</span>
                      <span className="tabular-nums">{convs} conversões</span>
                      {l.paises.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Globe className="size-3" /> {l.paises.join(', ')}
                        </span>
                      )}
                      {l.idiomas.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Languages className="size-3" /> {l.idiomas.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => copyUrl(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Copiar URL"
                    >
                      {copied === l.slug ? (
                        <Check className="size-4 text-[color:var(--success)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Editar link"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(l.slug)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Excluir link"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {deleting === l.slug && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-sm text-foreground">
                      Excluir <strong>{l.nome}</strong>? A URL /go/{l.slug} deixa de funcionar.
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleting(null)}
                        className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(l.slug)}
                        className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <LinkEditor
          link={editing}
          domains={domainsData?.domains ?? []}
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
    </div>
  )
}
