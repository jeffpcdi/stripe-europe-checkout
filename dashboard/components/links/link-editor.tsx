'use client'

import { useRef, useState } from 'react'
import { X, Tag, Shield, Plus, Trash2, FlaskConical } from 'lucide-react'
import { ApiError, apiSend } from '@/lib/api'
import type { CheckoutLink, CustomDomain } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'

interface LinkEditorProps {
  link: CheckoutLink | null
  domains: CustomDomain[]
  appHost?: string
  presetDominio?: string | null
  onClose: () => void
  onSaved: () => void
}

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
  const [dominio, setDominio] = useState(link?.dominio ?? presetDominio ?? '')
  const [urlWhitePage, setUrlWhitePage] = useState(link?.urlWhitePage ?? '')
  
  const [variantes, setVariantes] = useState(() => (link?.variantes?.length ? link.variantes : [{
    id: 'v1', nome: 'Variante A', url: '', urlMobile: null, peso: 100, clicks: 0, conversions: 0, revenue: {},
  }]).map((variant) => ({ ...variant })))
  const [experimentEnabled, setExperimentEnabled] = useState(link?.experiment?.enabled ?? false)
  const [autoStop, setAutoStop] = useState(link?.experiment?.autoStop ?? true)
  
  const [ativo, setAtivo] = useState(link?.ativo ?? true)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const isValidUrl = (u: string) => /^https:\/\/[^\s]+\.[^\s]+/i.test(u.trim())
  const urlInvalida = (u: string) => !!u.trim() && !isValidUrl(u)
  const temUrlInvalida = variantes.some((variant) => urlInvalida(variant.url)) || urlInvalida(urlWhitePage)

  function updateVariant(index: number, patch: Partial<(typeof variantes)[number]>) {
    setVariantes((current) => current.map((variant, i) => i === index ? { ...variant, ...patch } : variant))
  }

  async function handleSave() {
    if (savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      await apiSend('/api/links', 'POST', {
        slug: slug || nome,
        _createOnly: !link,
        _baseUpdatedAt: link?.updatedAt || undefined,
        nome,
        dominio: dominio || null,
        urlWhitePage: urlWhitePage || null,
        // Estes campos continuam existindo no backend, mas não estão expostos
        // neste editor simplificado. Em edição, preservamos o valor existente
        // para não apagar silenciosamente configurações feitas em versões
        // anteriores/por outros fluxos.
        paises: link?.paises ?? [],
        idiomas: link?.idiomas ?? [],
        pixelSlug: link?.pixelSlug ?? '',
        ativo,
        variantes: variantes.map((variant, index) => ({
          id: variant.id || 'v' + (index + 1),
          nome: variant.nome || `Variante ${String.fromCharCode(65 + index)}`,
          url: variant.url.trim(), urlMobile: variant.urlMobile || null,
          urlWhitePage: variant.urlWhitePage || null,
          peso: Number(variant.peso) || Math.round(100 / variantes.length),
        })),
        experiment: {
          enabled: experimentEnabled && variantes.length >= 2,
          autoStop,
          minVisitors: link?.experiment?.minVisitors || 80,
          minConversions: link?.experiment?.minConversions || 6,
          confidence: link?.experiment?.confidence || 0.95,
          minLiftPct: link?.experiment?.minLiftPct || 5,
          // Salvar nome/domínio/destino não deve reiniciar silenciosamente um
          // experimento já concluído nem apagar a última avaliação.
          status: link?.experiment?.status,
          winnerId: link?.experiment?.winnerId ?? null,
          concludedAt: link?.experiment?.concludedAt ?? null,
          lastEvaluation: link?.experiment?.lastEvaluation ?? null,
        },
      })
      onSaved()
    } catch (e) {
      setError(e instanceof ApiError ? e.display : e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const previewSlug = slug.trim() || slugify(nome) || 'seu-link'
  const previewHost = dominio || appHost || 'seu-dominio.com'
  const previewUrl = `https://${previewHost}/go/${previewSlug}`

  const inputCls =
    'w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 transition-all duration-300 hover:border-[color:var(--brand-cyan)]/40 hover:bg-secondary/60 focus:border-[color:var(--brand-cyan)] focus:bg-background focus:shadow-[0_0_25px_rgba(37,244,238,0.15)] focus:outline-none'

  const labelCls = "text-[11px] font-semibold text-muted-foreground transition-colors duration-300 group-focus-within:text-[color:var(--brand-cyan)] group-focus-within:drop-shadow-[0_0_5px_rgba(37,244,238,0.4)]"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-md md:items-center" role="dialog">
      <GlassCard variant="thick" className="relative z-10 w-full max-w-2xl p-6 animate-in zoom-in-[0.98] duration-200 border-border/80 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-[color:var(--brand-cyan)]/20 text-[color:var(--brand-cyan)]">
              <Tag className="size-4" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {link ? 'Editar link de venda' : 'Novo link de venda'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5">
          <label className="group flex flex-col gap-1.5">
            <span className={labelCls}>Nome do link</span>
            <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Oferta Black Friday" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="group flex flex-col gap-1.5">
              <span className={labelCls}>Domínio</span>
              <select className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                <option value="">Domínio padrão</option>
                {domains.map((d) => <option key={d.host} value={d.host}>{d.host}</option>)}
              </select>
            </label>
            <label className="group flex flex-col gap-1.5">
              <span className={labelCls}>Identificador da URL</span>
              <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(nome) || 'slug-aqui'} disabled={!!link} />
            </label>
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/15 px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">URL pública</p>
            <p className="mt-1 break-all font-mono text-xs text-brand-cyan">{previewUrl}</p>
          </div>

          <div className="relative rounded-2xl border border-border/60 bg-secondary/10 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="size-4 text-[color:var(--brand-cyan)]" />
              <h3 className="font-semibold text-foreground text-sm">Destino e distribuição</h3>
            </div>
            <div className="flex flex-col gap-4">
              <label className="group flex flex-col gap-1.5">
                <span className={labelCls}>Página segura opcional</span>
                <input
                  className={`${inputCls} ${urlInvalida(urlWhitePage) ? 'border-destructive' : ''}`}
                  value={urlWhitePage}
                  onChange={(e) => setUrlWhitePage(e.target.value)}
                  placeholder="https://meusite.com/pagina-segura"
                />
              </label>
              
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className={labelCls}>Destinos / variantes</span>
                  <button
                    type="button" className="btn-ghost text-[11px]" disabled={variantes.length >= 5}
                    onClick={() => setVariantes((current) => current.concat([{
                      id: 'v' + (current.length + 1), nome: `Variante ${String.fromCharCode(65 + current.length)}`,
                      url: '', urlMobile: null, peso: Math.round(100 / (current.length + 1)), clicks: 0, conversions: 0, revenue: {},
                    }]))}
                  >
                    <Plus className="size-3" /> Adicionar variante
                  </button>
                </div>
                {variantes.map((variant, index) => (
                  <div key={variant.id || index} className="grid gap-2 rounded-lg border border-border/50 bg-secondary/20 p-3 sm:grid-cols-[1fr_88px_auto]">
                    <label className="group flex flex-col gap-1">
                      <span className="text-[10px] text-muted-foreground">{variant.nome || `Variante ${String.fromCharCode(65 + index)}`}</span>
                      <input className={`${inputCls} ${urlInvalida(variant.url) ? 'border-destructive' : ''}`} value={variant.url} onChange={(event) => updateVariant(index, { url: event.target.value })} placeholder="https://pay.gateway.com/oferta" />
                    </label>
                    <label className="flex flex-col gap-1 text-[10px] text-muted-foreground">
                      Peso %
                      <input className={inputCls} type="number" min="0" max="100" value={variant.peso} onChange={(event) => updateVariant(index, { peso: Number(event.target.value) })} />
                    </label>
                    <button type="button" disabled={variantes.length === 1} onClick={() => setVariantes((current) => current.filter((_, i) => i !== index))} className="btn-ghost self-end !p-2 text-error" aria-label="Remover variante"><Trash2 className="size-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border/50 bg-secondary/20 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground"><FlaskConical className="size-4 text-primary" /> Teste A/B preditivo</p>
                <p className="mt-1 text-[11px] text-muted-foreground">O modelo Bayesiano reavalia a cada visita e pode concentrar 100% no vencedor em horas, com volume e confiança mínimos.</p>
              </div>
              <input type="checkbox" checked={experimentEnabled} disabled={variantes.length < 2} onChange={(event) => setExperimentEnabled(event.target.checked)} className="mt-1 size-4 accent-[color:var(--brand-cyan)]" aria-label="Ativar teste preditivo" />
            </div>
            {experimentEnabled && (
              <label className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={autoStop} onChange={(event) => setAutoStop(event.target.checked)} className="size-3.5 accent-[color:var(--brand-cyan)]" />
                Desativar automaticamente a variante perdedora ao atingir 95% de confiança
              </label>
            )}
            {link?.experiment?.lastEvaluation?.reason && <p className={`mt-3 rounded-lg px-3 py-2 text-[11px] ${link.experiment.status === 'concluded' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary'}`}>{link.experiment.lastEvaluation.reason}{link.experiment.winnerId ? ` Vencedora: ${link.variantes.find((variant) => variant.id === link.experiment?.winnerId)?.nome || link.experiment.winnerId}.` : ''}</p>}
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive" role="alert">
              <span className="font-bold mr-1">Erro:</span> {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-border/50 pt-5 mt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || variantes.some((variant) => !variant.url.trim()) || temUrlInvalida}
              className="btn-primary px-5 py-2.5 text-sm disabled:pointer-events-none disabled:opacity-50"
            >
              {saving ? 'Salvando...' : link ? 'Salvar alterações' : 'Criar Link de venda'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
