'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Plus, Trash2, RefreshCw } from 'lucide-react'
import { ApiError, apiSend } from '@/lib/api'
import { Switch } from '@/components/switch'
import type { CheckoutLink, CustomDomain } from '@/lib/types'
import { normalizePublicSlug, randomPublicSlug } from '@/lib/public-slug'

interface LinkEditorProps {
  link: CheckoutLink | null
  domains: CustomDomain[]
  appHost?: string
  presetDominio?: string | null
  onClose: () => void
  onSaved: () => void
}


export function LinkEditor({ link, domains, appHost = '', presetDominio = null, onClose, onSaved }: LinkEditorProps) {
  const [nome, setNome] = useState(link?.nome ?? '')
  const [slug, setSlug] = useState(link?.slug ?? '')
  useEffect(() => {
    if (!link && !slug) setSlug(randomPublicSlug())
  }, [link, slug])
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
        slug,
        _originalSlug: link?.slug || undefined,
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

  const previewSlug = normalizePublicSlug(slug) || 'seu-link'
  const previewHost = dominio || appHost || 'seu-dominio.com'
  const previewUrl = `https://${previewHost}/${previewSlug}`
  const selectedDomain = dominio ? domains.find((domain) => domain.host === dominio) : null
  const selectedDomainUnavailable = Boolean(selectedDomain && (!selectedDomain.verificado || (selectedDomain.status && selectedDomain.status !== 'active')))
  const experimentAvailable = variantes.length >= 2
  const confidencePct = Math.round((link?.experiment?.confidence ?? 0.95) * 100)
  const winnerName = link?.experiment?.winnerId
    ? link.variantes.find((variant) => variant.id === link.experiment?.winnerId)?.nome || link.experiment.winnerId
    : null

  const inputCls =
    'h-11 w-full rounded-lg border border-border/60 bg-secondary/20 px-3 text-sm text-foreground placeholder:text-muted-foreground/45 transition-colors hover:border-border/90 hover:bg-secondary/30 focus:border-[color:var(--brand-cyan)] focus:outline-none focus:ring-1 focus:ring-[color:var(--brand-cyan)]/35 disabled:cursor-not-allowed disabled:opacity-55'

  const labelCls = 'text-xs font-medium text-muted-foreground'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/[0.72] p-4 md:items-center" role="dialog" aria-modal="true" aria-labelledby="link-editor-title">
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-border/70 bg-background/95 p-5 shadow-[0_24px_70px_rgba(0,0,0,0.42)] md:p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 id="link-editor-title" className="text-lg font-semibold tracking-[-0.01em] text-foreground md:text-xl">
            {link ? 'Editar link de venda' : 'Novo link de venda'}
          </h2>
          <button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand-cyan)]/45" aria-label="Fechar editor">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-4" aria-label="Configuração do link">
            <label className="flex flex-col gap-2">
              <span className={labelCls}>Nome do link</span>
              <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Oferta Black Friday" />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-2">
                <span className={labelCls}>Domínio</span>
                <select className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                  <option value="">Domínio padrão</option>
                  {domains.map((d) => {
                    const ready = d.verificado && (!d.status || d.status === 'active')
                    return <option key={d.host} value={d.host} disabled={!ready}>{d.host}{ready ? '' : ' · não está pronto'}</option>
                  })}
                </select>
                {selectedDomainUnavailable && (
                  <span className="text-xs leading-relaxed text-warning">Este domínio não está ativo. Escolha outro domínio ou conclua a ativação em Domínios antes de salvar.</span>
                )}
              </label>
              <div className="flex flex-col gap-2">
                <span className={labelCls}>Endereço do link</span>
                <div className="flex gap-2">
                  <input
                    className={inputCls}
                    value={slug}
                    onChange={(e) => setSlug(normalizePublicSlug(e.target.value))}
                    placeholder="x78dfa7s"
                    aria-label="Endereço público do link"
                  />
                  <button
                    type="button"
                    onClick={() => setSlug(randomPublicSlug())}
                    className="grid size-11 shrink-0 place-items-center rounded-lg border border-border/60 text-muted-foreground transition-colors hover:border-border hover:bg-secondary/50 hover:text-foreground"
                    aria-label="Gerar outro endereço"
                    title="Gerar outro endereço"
                  >
                    <RefreshCw className="size-4" />
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className={labelCls}>URL pública</span>
              <p className="break-all text-[13px] font-medium text-[color:var(--brand-cyan)]/90">{previewUrl}</p>
            </div>
            {link && previewSlug !== link.slug && (
              <p className="text-xs leading-relaxed text-warning">
                Alterar o endereço pode fazer links já publicados pararem de funcionar. O endereço anterior não vira alias automaticamente.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-4 border-t border-border/45 pt-5" aria-labelledby="link-destination-title">
            <div className="flex items-center justify-between gap-3">
              <h3 id="link-destination-title" className="text-sm font-semibold text-foreground">Destino e distribuição</h3>
            </div>

            <label className="flex flex-col gap-2">
              <span className={labelCls}>Destino seguro próprio (opcional)</span>
              <input
                className={`${inputCls} ${urlInvalida(urlWhitePage) ? 'border-destructive focus:border-destructive focus:ring-destructive/30' : ''}`}
                value={urlWhitePage}
                onChange={(e) => setUrlWhitePage(e.target.value)}
                placeholder="https://meusite.com/pagina-segura"
              />
              {urlInvalida(urlWhitePage) && <span className="text-xs text-destructive">Informe uma URL HTTPS válida.</span>}
            </label>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-4">
                <span className={labelCls}>Destinos / variantes</span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  disabled={variantes.length >= 5}
                  onClick={() => setVariantes((current) => current.concat([{
                    id: 'v' + (current.length + 1), nome: `Variante ${String.fromCharCode(65 + current.length)}`,
                    url: '', urlMobile: null, peso: Math.round(100 / (current.length + 1)), clicks: 0, conversions: 0, revenue: {},
                  }]))}
                >
                  <Plus className="size-3.5" /> Adicionar variante
                </button>
              </div>

              <div className="divide-y divide-border/45">
                {variantes.map((variant, index) => (
                  <div key={variant.id || index} className="grid gap-3 py-3 first:pt-1 sm:grid-cols-[minmax(0,1fr)_92px_36px] sm:items-end">
                    <label className="flex min-w-0 flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">{variant.nome || `Variante ${String.fromCharCode(65 + index)}`}</span>
                      <input
                        className={`${inputCls} ${urlInvalida(variant.url) ? 'border-destructive focus:border-destructive focus:ring-destructive/30' : ''}`}
                        value={variant.url}
                        onChange={(event) => updateVariant(index, { url: event.target.value })}
                        placeholder="https://pay.gateway.com/oferta"
                      />
                      {urlInvalida(variant.url) && <span className="text-xs text-destructive">URL HTTPS inválida.</span>}
                    </label>
                    <label className="flex flex-col gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">Peso</span>
                      <div className="relative">
                        <input className={`${inputCls} pr-7 tabular-nums`} type="number" min="0" max="100" value={variant.peso} onChange={(event) => updateVariant(index, { peso: Number(event.target.value) })} />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                      </div>
                    </label>
                    <button type="button" disabled={variantes.length === 1} onClick={() => setVariantes((current) => current.filter((_, i) => i !== index))} className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/[0.08] hover:text-destructive disabled:pointer-events-none disabled:opacity-30" aria-label="Remover variante"><Trash2 className="size-4" /></button>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-4 border-t border-border/45 pt-5" aria-labelledby="link-experiment-title">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h3 id="link-experiment-title" className="text-sm font-semibold text-foreground">Teste A/B preditivo</h3>
                <p className="mt-1.5 max-w-xl text-[13px] leading-relaxed text-muted-foreground">
                  Distribui visitas entre variantes e concentra tráfego automaticamente na vencedora.
                </p>
              </div>
              <Switch
                checked={experimentEnabled}
                onCheckedChange={setExperimentEnabled}
                disabled={!experimentAvailable}
                aria-label="Ativar teste A/B preditivo"
                className="mt-0.5 shadow-none"
              />
            </div>

            {!experimentAvailable && (
              <p className="text-xs text-muted-foreground">Adicione pelo menos 2 variantes para ativar o teste.</p>
            )}

            {experimentEnabled && experimentAvailable && (
              <div className="flex flex-col gap-2.5 border-t border-border/35 pt-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-foreground">Encerrar automaticamente ao identificar uma vencedora</p>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Ao atingir {confidencePct}% de confiança, a variante perdedora é desativada.
                    </p>
                  </div>
                  <Switch
                    checked={autoStop}
                    onCheckedChange={setAutoStop}
                    aria-label="Encerrar teste automaticamente ao identificar uma vencedora"
                    className="mt-0.5 shadow-none"
                  />
                </div>
              </div>
            )}

            {link?.experiment?.lastEvaluation?.reason && (
              <p
                className={`text-xs font-medium ${link.experiment.status === 'concluded' ? 'text-success' : 'text-muted-foreground'}`}
                title={link.experiment.lastEvaluation.reason}
              >
                {link.experiment.status === 'concluded'
                  ? `Concluído${winnerName ? ` · ${winnerName} vencedora` : ''}`
                  : 'Em análise · avaliação em andamento'}
              </p>
            )}
          </section>

          {error && (
            <div className="border-l-2 border-destructive/70 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
              {error}
            </div>
          )}

          <div className="flex flex-col-reverse gap-2 border-t border-border/45 pt-5 sm:flex-row sm:justify-end sm:gap-3">
            <button type="button" onClick={onClose} disabled={saving} className="h-10 rounded-lg px-4 text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || variantes.some((variant) => !variant.url.trim()) || temUrlInvalida || selectedDomainUnavailable}
              className="btn-primary h-10 rounded-lg px-4 text-sm disabled:pointer-events-none disabled:opacity-50"
            >
              {saving ? 'Salvando...' : link ? 'Salvar alterações' : 'Criar Link de venda'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
