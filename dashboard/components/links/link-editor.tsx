'use client'

import { useState } from 'react'
import { X, Plus, Trash2 } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CheckoutLink, CustomDomain } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'

interface VariantDraft {
  id: string
  nome: string
  url: string
  urlMobile: string
  peso: number
}

interface LinkEditorProps {
  link: CheckoutLink | null // null = criar novo
  domains: CustomDomain[]
  onClose: () => void
  onSaved: () => void
}

export function LinkEditor({ link, domains, onClose, onSaved }: LinkEditorProps) {
  const [nome, setNome] = useState(link?.nome ?? '')
  const [slug, setSlug] = useState(link?.slug ?? '')
  const [dominio, setDominio] = useState(link?.dominio ?? '')
  const [urlWhitePage, setUrlWhitePage] = useState(link?.urlWhitePage ?? '')
  const [paises, setPaises] = useState((link?.paises ?? []).join(', '))
  const [idiomas, setIdiomas] = useState((link?.idiomas ?? []).join(', '))
  const [pixelSlug, setPixelSlug] = useState(link?.pixelSlug ?? '')
  const [ativo, setAtivo] = useState(link?.ativo ?? true)
  const [variantes, setVariantes] = useState<VariantDraft[]>(
    link?.variantes?.length
      ? link.variantes.map((v) => ({
          id: v.id,
          nome: v.nome,
          url: v.url,
          urlMobile: v.urlMobile ?? '',
          peso: v.peso,
        }))
      : [{ id: 'v1', nome: 'Variante 1', url: '', urlMobile: '', peso: 100 }],
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Validação de pesos do split A/B: só conta variantes com URL preenchida.
  // Com 2+ variantes a soma precisa ser 100 para a divisão fazer sentido.
  const activeVariants = variantes.filter((v) => v.url.trim())
  const totalPeso = activeVariants.reduce((s, v) => s + (Number.isFinite(v.peso) ? v.peso : 0), 0)
  const pesoInvalido = activeVariants.length >= 2 && totalPeso !== 100

  function updateVariant(i: number, patch: Partial<VariantDraft>) {
    setVariantes((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  }

  function addVariant() {
    setVariantes((vs) => [
      ...vs,
      { id: `v${vs.length + 1}`, nome: `Variante ${vs.length + 1}`, url: '', urlMobile: '', peso: 0 },
    ])
  }

  function removeVariant(i: number) {
    setVariantes((vs) => vs.filter((_, j) => j !== i))
  }

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await apiSend('/api/links', 'POST', {
        slug: slug || nome,
        nome,
        dominio: dominio || null,
        urlWhitePage: urlWhitePage || null,
        paises: paises
          .split(/[,\s]+/)
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        idiomas: idiomas
          .split(/[,\s]+/)
          .map((c) => c.trim().toLowerCase())
          .filter(Boolean),
        pixelSlug,
        ativo,
        variantes: variantes
          .filter((v) => v.url.trim())
          .map((v) => ({
            id: v.id,
            nome: v.nome,
            url: v.url.trim(),
            urlMobile: v.urlMobile.trim() || null,
            peso: v.peso,
          })),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={link ? 'Editar link' : 'Novo link'}
    >
      <GlassCard variant="thick" className="my-8 w-full max-w-2xl p-6">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {link ? `Editar link — ${link.nome}` : 'Novo link de checkout'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Nome</span>
              <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Oferta ES" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">
                Slug {link ? '(fixo)' : '(URL: /go/slug)'}
              </span>
              <input
                className={inputCls}
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="oferta-es"
                disabled={!!link}
              />
            </label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Domínio personalizado</span>
              <select className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                <option value="">Domínio padrão do app</option>
                {domains.map((d) => (
                  <option key={d.host} value={d.host}>
                    {d.host} {d.verificado ? '✓' : '(não verificado)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Pixel (slug — vazio = todos)</span>
              <input className={inputCls} value={pixelSlug} onChange={(e) => setPixelSlug(e.target.value)} placeholder="meu-pixel" />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">White page (cloak — revisores/bots)</span>
            <input
              className={inputCls}
              value={urlWhitePage}
              onChange={(e) => setUrlWhitePage(e.target.value)}
              placeholder="https://blog-inocente.com"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Países permitidos (ISO-2, vazio = todos)</span>
              <input className={inputCls} value={paises} onChange={(e) => setPaises(e.target.value)} placeholder="ES, PT, IT" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Idiomas permitidos (vazio = todos)</span>
              <input className={inputCls} value={idiomas} onChange={(e) => setIdiomas(e.target.value)} placeholder="es, pt" />
            </label>
          </div>

          {/* Variantes A/B */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">
                Variantes (split A/B por peso)
                {activeVariants.length >= 2 && (
                  <span
                    className={`ml-2 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                      pesoInvalido
                        ? 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'
                        : 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
                    }`}
                  >
                    soma {totalPeso}%
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={addVariant}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
              >
                <Plus className="size-3.5" /> Adicionar
              </button>
            </div>
            {pesoInvalido && (
              <p className="mb-2 rounded-lg bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)] text-pretty" role="alert">
                Os pesos das variantes precisam somar 100% (atualmente {totalPeso}%). Ajuste os valores para o
                split A/B dividir o tráfego direito.
              </p>
            )}
            <div className="flex flex-col gap-2">
              {variantes.map((v, i) => (
                <div key={v.id} className="rounded-lg border border-border bg-secondary/40 p-3">
                  <div className="mb-2 grid grid-cols-[1fr_80px_32px] items-end gap-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Nome</span>
                      <input
                        className={inputCls}
                        value={v.nome}
                        onChange={(e) => updateVariant(i, { nome: e.target.value })}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">Peso %</span>
                      <input
                        className={inputCls}
                        type="number"
                        min={0}
                        max={100}
                        value={v.peso}
                        onChange={(e) => updateVariant(i, { peso: Number(e.target.value) })}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => removeVariant(i)}
                      disabled={variantes.length === 1}
                      className="mb-0.5 rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive disabled:opacity-40"
                      aria-label={`Remover ${v.nome}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">URL do checkout</span>
                      <input
                        className={inputCls}
                        value={v.url}
                        onChange={(e) => updateVariant(i, { url: e.target.value })}
                        placeholder="https://pay.gateway.com/abc"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">URL mobile (opcional)</span>
                      <input
                        className={inputCls}
                        value={v.urlMobile}
                        onChange={(e) => updateVariant(i, { urlMobile: e.target.value })}
                        placeholder="https://pay.gateway.com/abc-m"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={ativo}
              onChange={(e) => setAtivo(e.target.checked)}
              className="size-4 accent-[color:var(--brand-cyan)]"
            />
            Link ativo
          </label>

          {error && (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || !variantes.some((v) => v.url.trim()) || pesoInvalido}
              className="rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
            >
              {saving ? 'Salvando…' : 'Salvar link'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
