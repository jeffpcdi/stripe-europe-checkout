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
  /** Item 124: domínio pré-selecionado (atalho "usar em um link" da aba Domínios). */
  presetDominio?: string | null
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

export function LinkEditor({ link, domains, appHost = '', presetDominio = null, onClose, onSaved }: LinkEditorProps) {
  const [nome, setNome] = useState(link?.nome ?? '')
  const [slug, setSlug] = useState(link?.slug ?? '')
  // Item 124: criação vinda do atalho da aba Domínios já nasce com o domínio
  const [dominio, setDominio] = useState(link?.dominio ?? presetDominio ?? '')
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
      : [{ id: 'v1', nome: 'Versão 1', url: '', urlMobile: '', peso: 100 }],
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
      { id: `v${vs.length + 1}`, nome: `Versão ${vs.length + 1}`, url: '', urlMobile: '', peso: 0 },
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
        // Item 235: concorrência otimista — envia o updatedAt visto ao abrir
        // o formulário; o backend devolve 409 se o link mudou nesse meio-tempo
        _baseUpdatedAt: link?.updatedAt || undefined,
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
    'w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 transition-all duration-300 hover:border-[color:var(--brand-cyan)]/40 hover:bg-secondary/60 focus:border-[color:var(--brand-cyan)] focus:bg-background focus:shadow-[0_0_25px_rgba(37,244,238,0.15)] focus:outline-none group-focus-within:border-[color:var(--brand-cyan)]/50'

  const labelCls = "text-[11px] font-semibold text-muted-foreground transition-colors duration-300 group-focus-within:text-[color:var(--brand-cyan)] group-focus-within:drop-shadow-[0_0_5px_rgba(37,244,238,0.4)]"

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:items-center transition-all animate-in fade-in duration-500"
      role="dialog"
      aria-modal="true"
      aria-label={link ? 'Editar link' : 'Novo link'}
    >
      {/* Black Hole Backdrop Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.4)_0%,rgba(0,0,0,0.9)_100%)] backdrop-blur-3xl pointer-events-none" />

      <GlassCard variant="thick" className="relative z-10 my-8 w-full max-w-2xl p-6 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05),0_30px_60px_-15px_rgba(0,0,0,0.5),0_0_100px_rgba(37,244,238,0.1)] animate-in zoom-in-[0.98] duration-300 ease-out">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]">
            {link ? `Editar link — ${link.nome}` : 'Novo link de checkout'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="group/close rounded-full p-1.5 text-muted-foreground transition-all duration-300 hover:bg-destructive/10 hover:text-destructive"
            aria-label="Fechar"
          >
            <X className="size-4 transition-transform duration-300 group-hover/close:rotate-90 group-hover/close:scale-110" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="group flex flex-col gap-1.5 relative">
              <span className={labelCls}>Nome</span>
              <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Oferta ES" />
            </label>
            <label className="group flex flex-col gap-1.5 relative">
              <span className={labelCls}>
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
            <label className="group flex flex-col gap-1.5 relative">
              <span className={labelCls}>Domínio personalizado</span>
              <select className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                <option value="">Domínio padrão do app</option>
                {domains.map((d) => (
                  <option key={d.host} value={d.host}>
                    {d.host} {d.verificado ? '✓' : '(não verificado)'}
                  </option>
                ))}
              </select>
            </label>
            <label className="group flex flex-col gap-1.5 relative">
              <span className={labelCls}>Pixel (slug — vazio = todos)</span>
              <input className={inputCls} value={pixelSlug} onChange={(e) => setPixelSlug(e.target.value)} placeholder="meu-pixel" />
            </label>
          </div>

          {dominioMudou && (
            <div
              className="flex items-center gap-2 rounded-lg bg-gradient-to-r from-[color:var(--warning)]/20 to-[color:var(--warning)]/5 border border-[color:var(--warning)]/30 px-4 py-3 text-xs text-[color:var(--warning)] shadow-inner animate-in slide-in-from-top-2 duration-300"
              role="alert"
            >
              <div className="size-1.5 rounded-full bg-[color:var(--warning)] animate-pulse" />
              <p>Ao trocar o domínio, a validação anterior deixa de valer: o link será salvo como &quot;domínio não verificado&quot;.</p>
            </div>
          )}

          <label className="group flex flex-col gap-1.5 relative">
            <span className={labelCls}>Página segura (fallback para revisão)</span>
            <input
              className={`${inputCls} ${urlInvalida(urlWhitePage) ? 'border-destructive focus:border-destructive focus:shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-[shake_0.5s]' : ''}`}
              value={urlWhitePage}
              onChange={(e) => setUrlWhitePage(e.target.value)}
              placeholder="https://blog-inocente.com"
              aria-invalid={urlInvalida(urlWhitePage)}
            />
            {urlInvalida(urlWhitePage) && (
              <span className="text-[11px] text-destructive animate-in slide-in-from-top-1">
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
                flags
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

          {/* Versões A/B */}
          <div>
            <div className="mb-3 flex items-center justify-between">
              <span className="text-sm font-semibold text-foreground flex items-center gap-2">
                Versões (teste A/B)
                {activeVariants.length >= 2 && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums transition-colors duration-500 shadow-inner border ${
                      pesoInvalido
                        ? 'bg-[color:var(--warning)]/20 text-[color:var(--warning)] border-[color:var(--warning)]/30 drop-shadow-[0_0_8px_rgba(234,179,8,0.3)] animate-pulse'
                        : 'bg-[color:var(--success)]/20 text-[color:var(--success)] border-[color:var(--success)]/30 drop-shadow-[0_0_8px_rgba(34,197,94,0.3)]'
                    }`}
                  >
                    soma {totalPeso}%
                  </span>
                )}
              </span>
              <button
                type="button"
                onClick={addVariant}
                className="group/add flex items-center gap-1.5 rounded-full border border-dashed border-[color:var(--brand-cyan)]/40 px-3 py-1.5 text-xs font-semibold text-[color:var(--brand-cyan)] transition-all duration-300 hover:bg-[color:var(--brand-cyan)]/10 hover:border-[color:var(--brand-cyan)]"
              >
                <Plus className="size-3.5 transition-transform group-hover/add:rotate-90 group-hover/add:scale-110" /> Adicionar
              </button>
            </div>
            {pesoInvalido && (
              <div
                className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[color:var(--warning)]/10 px-3 py-2 text-xs text-[color:var(--warning)]"
                role="alert"
              >
                <span className="text-pretty">
                  Os pesos das versões precisam somar 100% (atualmente {totalPeso}%).
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
            <div className="flex flex-col gap-3">
              {variantes.map((v, i) => (
                <div key={v.id} className="relative rounded-xl border border-border/60 bg-secondary/20 p-4 transition-all duration-300 hover:border-border hover:shadow-lg animate-in fade-in slide-in-from-bottom-4 group/variant">
                  <div className="mb-3 grid grid-cols-[1fr_90px] sm:grid-cols-[1fr_100px] items-start gap-3">
                    <label className="group flex flex-col gap-1.5">
                      <span className={labelCls}>Nome da Versão</span>
                      <input
                        className={inputCls}
                        value={v.nome}
                        onChange={(e) => updateVariant(i, { nome: e.target.value })}
                      />
                    </label>
                    <label className="group flex flex-col gap-1.5 relative">
                      <span className={labelCls}>Peso %</span>
                      <div className="relative">
                        <input
                          className={`${inputCls} pr-8 tabular-nums`}
                          type="number"
                          min={0}
                          max={100}
                          value={v.peso}
                          onChange={(e) => updateVariant(i, { peso: Number(e.target.value) })}
                        />
                        {/* Indicador visual de peso oculto no fundo */}
                        <div className="absolute bottom-0 left-0 h-0.5 bg-[color:var(--brand-cyan)]/50 rounded-bl-lg transition-all duration-500 pointer-events-none" style={{ width: `${v.peso}%` }} />
                      </div>
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeVariant(i)}
                    disabled={variantes.length === 1}
                    className="absolute -right-2 -top-2 rounded-full border border-border/50 bg-background p-1.5 text-muted-foreground opacity-0 shadow-lg transition-all duration-300 hover:scale-110 hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive group-hover/variant:opacity-100 disabled:hidden"
                    aria-label={`Remover ${v.nome}`}
                  >
                    <X className="size-3.5" />
                  </button>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="group flex flex-col gap-1.5">
                      <span className={labelCls}>URL do checkout</span>
                      <input
                        className={`${inputCls} ${urlInvalida(v.url) ? 'border-destructive focus:border-destructive animate-[shake_0.5s]' : ''}`}
                        value={v.url}
                        onChange={(e) => updateVariant(i, { url: e.target.value })}
                        placeholder="https://pay.gateway.com/abc"
                        aria-invalid={urlInvalida(v.url)}
                      />
                      {urlInvalida(v.url) && (
                        <span className="text-[11px] text-destructive animate-in slide-in-from-top-1">
                          A URL precisa começar com https://.
                        </span>
                      )}
                    </label>
                    <label className="group flex flex-col gap-1.5">
                      <span className={labelCls}>URL mobile (opcional)</span>
                      <input
                        className={`${inputCls} ${urlInvalida(v.urlMobile) ? 'border-destructive focus:border-destructive animate-[shake_0.5s]' : ''}`}
                        value={v.urlMobile}
                        onChange={(e) => updateVariant(i, { urlMobile: e.target.value })}
                        placeholder="https://pay.gateway.com/abc-m"
                        aria-invalid={urlInvalida(v.urlMobile)}
                      />
                      {urlInvalida(v.urlMobile) && (
                        <span className="text-[11px] text-destructive animate-in slide-in-from-top-1">
                          A URL precisa começar com https://.
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
          <div className="relative overflow-hidden rounded-xl border border-border bg-secondary/10 shadow-inner group/utm transition-all duration-300">
            {/* Technical grid background */}
            <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI4IiBoZWlnaHQ9IjgiPjxyZWN0IHdpZHRoPSI4IiBoZWlnaHQ9IjgiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMiIvPjwvc3ZnPg==')] opacity-10 pointer-events-none" />
            
            <button
              type="button"
              onClick={() => setShowUtm((s) => !s)}
              className="relative z-10 flex w-full items-center justify-between gap-2 px-4 py-3 text-left transition-colors hover:bg-secondary/20"
              aria-expanded={showUtm}
            >
              <span className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Tag className="size-4 text-[color:var(--brand-cyan)] transition-transform group-hover/utm:-rotate-12" aria-hidden="true" />
                UTM Builder <span className="text-[10px] font-mono text-muted-foreground px-1.5 py-0.5 rounded-md bg-secondary border border-border">/go/slug?utm...</span>
              </span>
              <Plus className={`size-4 text-muted-foreground transition-transform duration-300 ${showUtm ? 'rotate-45' : ''}`} />
            </button>
            <div className={`grid transition-all duration-500 ease-in-out ${showUtm ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}>
              <div className="overflow-hidden">
                <div className="relative z-10 flex flex-col gap-4 border-t border-border/50 bg-black/20 backdrop-blur-sm px-4 py-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    {(
                      [
                        ['source', 'utm_source', 'facebook'],
                        ['medium', 'utm_medium', 'cpc'],
                        ['campaign', 'utm_campaign', 'promo'],
                        ['content', 'utm_content', 'ad01'],
                        ['term', 'utm_term', 'keyword'],
                      ] as const
                    ).map(([key, label, ph]) => (
                      <label key={key} className="group flex flex-col gap-1.5">
                        <span className="font-mono text-[10px] uppercase text-muted-foreground transition-colors group-focus-within:text-[color:var(--brand-cyan)]">{label}</span>
                        <input
                          className={inputCls}
                          value={utm[key]}
                          onChange={(e) => setUtm((u) => ({ ...u, [key]: e.target.value }))}
                          placeholder={ph}
                        />
                      </label>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 shadow-inner">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground/80 selection:bg-[color:var(--brand-cyan)]/30 selection:text-white">
                      {utmUrl}
                    </code>
                    <button
                      type="button"
                      onClick={copyUtm}
                      className="group/copy flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold text-[color:var(--brand-cyan)] transition-all hover:bg-[color:var(--brand-cyan)]/10 hover:shadow-[0_0_15px_rgba(37,244,238,0.2)]"
                      aria-label="Copiar URL com UTM"
                    >
                      {utmCopied ? (
                        <>
                          <Check className="size-3.5 text-white drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]" /> 
                          <span className="text-white drop-shadow-[0_0_5px_rgba(255,255,255,0.8)]">Copiado</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3.5 transition-transform group-hover/copy:scale-110" /> Copiar
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-[11px] text-muted-foreground text-pretty">
                    O <code>/go/{utmSlug}</code> registra o clique e redireciona. Os parâmetros UTM chegam intactos na página final.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive shadow-inner animate-in slide-in-from-top-2" role="alert">
              <span className="font-bold mr-1">Erro:</span> {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-border/50 pt-5 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || !variantes.some((v) => v.url.trim()) || pesoInvalido || temUrlInvalida}
              className={`group/save relative flex items-center gap-2 overflow-hidden rounded-full bg-[color:var(--brand-cyan)] px-6 py-2.5 text-sm font-bold text-black shadow-[0_0_15px_rgba(37,244,238,0.4)] transition-all duration-300 hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50 disabled:shadow-none disabled:scale-100 ${saving ? 'bg-white shadow-[0_0_30px_rgba(255,255,255,0.6)]' : 'hover:shadow-[0_0_25px_rgba(37,244,238,0.7)] hover:brightness-110'}`}
            >
              {saving ? (
                <>
                  {/* Neon ring spinner */}
                  <svg className="size-4 animate-spin text-black" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Salvando…
                </>
              ) : (
                <>
                  <div className="absolute inset-0 bg-white/20 opacity-0 transition-opacity duration-300 group-hover/save:opacity-100 mix-blend-overlay" />
                  Salvar link
                </>
              )}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
