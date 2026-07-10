'use client'

import { useState } from 'react'
import { X, Plus, Trash2, Copy, Check, Tag } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CheckoutLink, CustomDomain } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { GeoMultiSelect } from '@/components/cloak/geo-multi-select'
import {
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  labelForCountry,
  labelForLanguage,
} from '@/lib/geo-options'

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
  /** Host padrão do app (para montar a URL pública no UTM builder). */
  appHost?: string
  onClose: () => void
  onSaved: () => void
}

// Item 75: grupos de mercado prontos — o usuário aplica um preset e ajusta.
// Reusa os mesmos códigos de geo-options (sem duplicar rótulos).
const COUNTRY_PRESETS: { label: string; codes: string[] }[] = [
  { label: 'Lusófonos', codes: ['BR', 'PT', 'AO', 'MZ', 'CV'] },
  { label: 'LATAM', codes: ['BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'UY', 'PY', 'BO', 'EC', 'VE'] },
  { label: 'Europa', codes: ['PT', 'ES', 'FR', 'DE', 'GB', 'IE', 'IT', 'NL', 'BE', 'CH', 'AT'] },
]
const LANGUAGE_PRESETS: { label: string; codes: string[] }[] = [
  { label: 'Ibéricos', codes: ['pt', 'es'] },
  { label: 'Europa', codes: ['pt', 'es', 'en', 'fr', 'de', 'it'] },
]

// slug de preview do UTM builder enquanto o campo slug ainda está vazio
function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function LinkEditor({ link, domains, appHost = '', onClose, onSaved }: LinkEditorProps) {
  const [nome, setNome] = useState(link?.nome ?? '')
  const [slug, setSlug] = useState(link?.slug ?? '')
  const [dominio, setDominio] = useState(link?.dominio ?? '')
  const [urlWhitePage, setUrlWhitePage] = useState(link?.urlWhitePage ?? '')
  // Item 75: seleção por nome (arrays de códigos) em vez de texto livre
  const [paises, setPaises] = useState<string[]>(link?.paises ?? [])
  const [idiomas, setIdiomas] = useState<string[]>(link?.idiomas ?? [])
  const [pixelSlug, setPixelSlug] = useState(link?.pixelSlug ?? '')
  const [ativo, setAtivo] = useState(link?.ativo ?? true)
  // Item 71: UTM builder (colapsável) para montar a URL de anúncio
  const [showUtm, setShowUtm] = useState(false)
  const [utm, setUtm] = useState({ source: '', medium: '', campaign: '', content: '', term: '' })
  const [utmCopied, setUtmCopied] = useState(false)
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

  // Item 73: validação de URL no front, com o MESMO critério do backend
  // (validUrl no link-store.js exige https://) — antes o erro só voltava
  // genérico do servidor depois do save.
  const isValidUrl = (u: string) => /^https:\/\/[^\s]+\.[^\s]+/i.test(u.trim())
  const urlInvalida = (u: string) => !!u.trim() && !isValidUrl(u)
  const temUrlInvalida =
    variantes.some((v) => urlInvalida(v.url) || urlInvalida(v.urlMobile)) || urlInvalida(urlWhitePage)

  // Item 74: trocar o domínio de um link existente derruba a validação
  // anterior (o save() do backend zera dominioValidado) — avisar ANTES do save.
  const dominioMudou = !!link && (link.dominio ?? '') !== dominio && !!dominio

  function updateVariant(i: number, patch: Partial<VariantDraft>) {
    setVariantes((vs) => vs.map((v, j) => (j === i ? { ...v, ...patch } : v)))
  }

  // Item 36: reescala proporcionalmente os pesos das variantes ATIVAS para
  // somarem exatamente 100 (a sobra do arredondamento vai para a primeira).
  function normalizePesos() {
    setVariantes((vs) => {
      const ativas = vs.filter((v) => v.url.trim())
      if (ativas.length === 0) return vs
      const soma = ativas.reduce((s, v) => s + (Number.isFinite(v.peso) && v.peso > 0 ? v.peso : 0), 0)
      // Se tudo é 0, distribui igualmente; senão reescala proporcional.
      const escalados = ativas.map((v) =>
        soma > 0 ? Math.round(((Number.isFinite(v.peso) && v.peso > 0 ? v.peso : 0) / soma) * 100) : Math.floor(100 / ativas.length),
      )
      const diff = 100 - escalados.reduce((s, p) => s + p, 0)
      escalados[0] += diff
      let k = 0
      return vs.map((v) => (v.url.trim() ? { ...v, peso: escalados[k++] } : v))
    })
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

  // Item 75: aplica um preset somando os códigos que ainda não estavam lá
  function applyPreset(
    current: string[],
    setter: (v: string[]) => void,
    codes: string[],
    norm: (s: string) => string,
  ) {
    const seen = new Set(current.map(norm))
    const next = [...current]
    for (const c of codes) {
      const n = norm(c)
      if (!seen.has(n)) {
        seen.add(n)
        next.push(n)
      }
    }
    setter(next)
  }

  // Item 71: monta a URL pública do link com os parâmetros UTM preenchidos.
  // É a URL que o usuário cola no anúncio — o /go rastreia o clique e redireciona.
  const utmSlug = slug.trim() || slugify(nome) || 'slug'
  const utmHost = dominio || appHost || 'seu-dominio.com'
  const utmBase = `https://${utmHost}/go/${utmSlug}`
  const utmPairs = (
    [
      ['utm_source', utm.source],
      ['utm_medium', utm.medium],
      ['utm_campaign', utm.campaign],
      ['utm_content', utm.content],
      ['utm_term', utm.term],
    ] as const
  ).filter(([, v]) => v.trim())
  const utmUrl = utmPairs.length
    ? `${utmBase}?${utmPairs.map(([k, v]) => `${k}=${encodeURIComponent(v.trim())}`).join('&')}`
    : utmBase

  async function copyUtm() {
    await navigator.clipboard.writeText(utmUrl)
    setUtmCopied(true)
    setTimeout(() => setUtmCopied(false), 1500)
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
        paises: paises.map((c) => c.trim().toUpperCase()).filter(Boolean),
        idiomas: idiomas.map((c) => c.trim().toLowerCase()).filter(Boolean),
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

          {dominioMudou && (
            <p
              className="rounded-lg bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)]"
              role="alert"
            >
              Ao trocar o domínio, a validação anterior deixa de valer: o link será salvo como
              &quot;domínio não verificado&quot; até você validar {dominio} de novo.
            </p>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">White page (cloak — revisores/bots)</span>
            <input
              className={`${inputCls} ${urlInvalida(urlWhitePage) ? 'border-destructive focus:ring-destructive' : ''}`}
              value={urlWhitePage}
              onChange={(e) => setUrlWhitePage(e.target.value)}
              placeholder="https://blog-inocente.com"
              aria-invalid={urlInvalida(urlWhitePage)}
            />
            {urlInvalida(urlWhitePage) && (
              <span className="text-[11px] text-destructive">
                A URL precisa começar com https:// e ter um domínio válido.
              </span>
            )}
          </label>

          {/* Item 75: seleção por nome + presets de mercado + colar lista */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Países permitidos (vazio = todos)
                </span>
                {COUNTRY_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(paises, setPaises, p.codes, (s) => s.trim().toUpperCase())}
                    className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    + {p.label}
                  </button>
                ))}
                {paises.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPaises([])}
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-destructive"
                  >
                    limpar
                  </button>
                )}
              </div>
              <GeoMultiSelect
                value={paises}
                onChange={setPaises}
                options={COUNTRY_OPTIONS}
                normalize={(s) => s.trim().toUpperCase()}
                labelFor={labelForCountry}
                emptyLabel="Todos os países"
                placeholder="Buscar país ou colar lista (ex.: BR, PT)"
                manualPattern={/^[A-Za-z]{2}$/}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  Idiomas permitidos (vazio = todos)
                </span>
                {LANGUAGE_PRESETS.map((p) => (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => applyPreset(idiomas, setIdiomas, p.codes, (s) => s.trim().toLowerCase())}
                    className="rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  >
                    + {p.label}
                  </button>
                ))}
                {idiomas.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIdiomas([])}
                    className="rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-destructive"
                  >
                    limpar
                  </button>
                )}
              </div>
              <GeoMultiSelect
                value={idiomas}
                onChange={setIdiomas}
                options={LANGUAGE_OPTIONS}
                normalize={(s) => s.trim().toLowerCase()}
                labelFor={labelForLanguage}
                emptyLabel="Todos os idiomas"
                placeholder="Buscar idioma ou colar lista (ex.: pt, es)"
                manualPattern={/^[A-Za-z]{2}$/}
              />
            </div>
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
              <div
                className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)]"
                role="alert"
              >
                <span className="text-pretty">
                  Os pesos das variantes precisam somar 100% (atualmente {totalPeso}%).
                </span>
                <button
                  type="button"
                  onClick={normalizePesos}
                  className="shrink-0 rounded-md border border-[color:var(--warning)]/40 px-2 py-1 font-semibold transition-colors hover:bg-[color:var(--warning)]/15"
                >
                  Normalizar para 100%
                </button>
              </div>
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
                        className={`${inputCls} ${urlInvalida(v.url) ? 'border-destructive focus:ring-destructive' : ''}`}
                        value={v.url}
                        onChange={(e) => updateVariant(i, { url: e.target.value })}
                        placeholder="https://pay.gateway.com/abc"
                        aria-invalid={urlInvalida(v.url)}
                      />
                      {urlInvalida(v.url) && (
                        <span className="text-[11px] text-destructive">
                          A URL precisa começar com https:// e ter um domínio válido.
                        </span>
                      )}
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-[11px] text-muted-foreground">URL mobile (opcional)</span>
                      <input
                        className={`${inputCls} ${urlInvalida(v.urlMobile) ? 'border-destructive focus:ring-destructive' : ''}`}
                        value={v.urlMobile}
                        onChange={(e) => updateVariant(i, { urlMobile: e.target.value })}
                        placeholder="https://pay.gateway.com/abc-m"
                        aria-invalid={urlInvalida(v.urlMobile)}
                      />
                      {urlInvalida(v.urlMobile) && (
                        <span className="text-[11px] text-destructive">
                          A URL precisa começar com https:// e ter um domínio válido.
                        </span>
                      )}
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

          {/* Item 71: UTM builder — monta a URL de anúncio a partir dos campos */}
          <div className="rounded-lg border border-border bg-secondary/30">
            <button
              type="button"
              onClick={() => setShowUtm((s) => !s)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
              aria-expanded={showUtm}
            >
              <span className="flex items-center gap-2 text-xs font-medium text-foreground">
                <Tag className="size-3.5 text-[color:var(--brand-cyan)]" aria-hidden="true" />
                Montar URL com UTM (para anúncios)
              </span>
              <span className="text-[11px] text-muted-foreground">{showUtm ? 'ocultar' : 'abrir'}</span>
            </button>
            {showUtm && (
              <div className="flex flex-col gap-3 border-t border-border px-3 py-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  {(
                    [
                      ['source', 'utm_source', 'facebook'],
                      ['medium', 'utm_medium', 'cpc'],
                      ['campaign', 'utm_campaign', 'promo-verao'],
                      ['content', 'utm_content', 'anuncio-a'],
                      ['term', 'utm_term', 'palavra-chave'],
                    ] as const
                  ).map(([key, label, ph]) => (
                    <label key={key} className="flex flex-col gap-1">
                      <span className="font-mono text-[10px] text-muted-foreground">{label}</span>
                      <input
                        className={inputCls}
                        value={utm[key]}
                        onChange={(e) => setUtm((u) => ({ ...u, [key]: e.target.value }))}
                        placeholder={ph}
                      />
                    </label>
                  ))}
                </div>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-input px-3 py-2">
                  <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground">
                    {utmUrl}
                  </code>
                  <button
                    type="button"
                    onClick={copyUtm}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
                    aria-label="Copiar URL com UTM"
                  >
                    {utmCopied ? (
                      <>
                        <Check className="size-3.5 text-[color:var(--success)]" /> Copiado
                      </>
                    ) : (
                      <>
                        <Copy className="size-3.5" /> Copiar
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground text-pretty">
                  Cole esta URL nos anúncios. O <code>/go/{utmSlug}</code> registra o clique e redireciona
                  para o checkout — os parâmetros UTM seguem para a página de destino.
                </p>
              </div>
            )}
          </div>

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
              disabled={saving || !nome.trim() || !variantes.some((v) => v.url.trim()) || pesoInvalido || temUrlInvalida}
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
