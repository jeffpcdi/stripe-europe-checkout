'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, ExternalLink, ChevronDown, RefreshCw } from 'lucide-react'
import { apiSend, useCloakConfig, useDomains } from '@/lib/api'
import type { CloakEntry, CloakSensitivity } from '@/lib/types'
import { normalizePublicSlug, randomPublicSlug } from '@/lib/public-slug'
import { GeoMultiSelect } from './geo-multi-select'
import { Switch } from '@/components/ui/switch'
import {
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  labelForCountry,
  labelForLanguage,
} from '@/lib/geo-options'

const SENSITIVITIES: {
  value: Exclude<CloakSensitivity, 'custom'>
  label: string
  hint: string
  desc: string
}[] = [
  {
    value: 'strict',
    label: 'Rígida',
    hint: 'Mais proteção · limite 30',
    desc: 'Mais sensível a sinais suspeitos. Protege mais, mas aumenta a chance de enviar usuários legítimos ao destino seguro.',
  },
  {
    value: 'balanced',
    label: 'Equilibrada',
    hint: 'Recomendada · limite 40',
    desc: 'Equilíbrio recomendado entre proteção contra automação e preservação dos acessos legítimos.',
  },
  {
    value: 'loose',
    label: 'Leve',
    hint: 'Menos falsos positivos · limite 55',
    desc: 'Mais tolerante. Reduz falsos positivos, mas permite que mais tráfego suspeito chegue ao destino principal.',
  },
]

const EFFECTIVE_THRESHOLD: Record<string, number> = { strict: 30, balanced: 40, loose: 55 }

interface Props {
  entry: CloakEntry | null
  initialDomain?: string
  onClose: () => void
  onSaved: () => void
}

export function CloakEntryEditor({ entry, initialDomain = '', onClose, onSaved }: Props) {
  const [nome, setNome] = useState(entry?.nome ?? '')
  const [slug, setSlug] = useState(entry?.slug ?? '')
  const [offerUrl, setOfferUrl] = useState(entry?.offerUrl ?? '')
  const [whitePageUrl, setWhitePageUrl] = useState(entry?.whitePageUrl ?? '')
  const [dominio, setDominio] = useState(entry?.dominio ?? initialDomain)
  const [trafficSource, setTrafficSource] = useState<'tiktok_standard' | 'tiktok_smart_plus' | 'custom'>(entry?.trafficSource ?? 'tiktok_standard')
  const [enabled, setEnabled] = useState(entry?.enabled ?? true)
  const [shadowMode, setShadowMode] = useState(entry?.shadowMode ?? false)
  const [mobileOnly, setMobileOnly] = useState(entry?.mobileOnly ?? false)
  const [sensitivity, setSensitivity] = useState<CloakSensitivity>(entry?.sensitivity ?? 'balanced')
  const [paises, setPaises] = useState<string[]>(entry?.paises ?? [])
  const [idiomas, setIdiomas] = useState<string[]>(entry?.idiomas ?? [])
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const createRequestRef = useRef<{ signature: string; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!entry && !slug) setSlug(randomPublicSlug())
  }, [entry, slug])
  const [segmentationOpen, setSegmentationOpen] = useState(() => Boolean(entry?.mobileOnly || (entry?.paises && entry.paises.length > 0) || (entry?.idiomas && entry.idiomas.length > 0)))

  const { data: domainsData } = useDomains()
  const { data: globalConfig } = useCloakConfig()
  const verifiedDomains = (domainsData?.domains ?? []).filter((d) => d.verificado && (!d.status || d.status === 'active') && (entry ? d.uso !== 'checkout' : d.uso === 'cloaker'))
  const currentInList = verifiedDomains.some((d) => d.host === dominio)
  const globalSafePage = globalConfig?.defaultWhitePage?.trim() ?? ''
  const globalShadowMode = globalConfig?.shadowMode === true
  const effectiveShadowMode = shadowMode || globalShadowMode
  const selectedSensitivity = SENSITIVITIES.find((item) => item.value === sensitivity)
  const customThreshold = entry?.threshold ?? 40
  const effectiveThreshold = sensitivity === 'custom' ? customThreshold : EFFECTIVE_THRESHOLD[sensitivity] ?? 40
  const segmentBits = [
    mobileOnly ? 'mobile' : null,
    paises.length > 0 ? `${paises.length} ${paises.length === 1 ? 'país' : 'países'}` : null,
    idiomas.length > 0 ? `${idiomas.length} ${idiomas.length === 1 ? 'idioma' : 'idiomas'}` : null,
  ].filter(Boolean) as string[]

  async function handleSave() {
    if (savingRef.current) return
    setError(null)
    if (!nome.trim() && !entry) return setError('Dê um nome à campanha')
    if (!dominio.trim()) return setError('Escolha um domínio dedicado ao Cloaker')
    if (!/^https:\/\//.test(offerUrl.trim())) return setError('O destino principal precisa ser uma URL https:// válida')

    const signature = JSON.stringify({
      nome: nome.trim(), slug: normalizePublicSlug(slug), offerUrl: offerUrl.trim(), whitePageUrl: whitePageUrl.trim(),
      dominio: dominio.trim(), trafficSource, enabled, shadowMode, mobileOnly, sensitivity, paises, idiomas,
    })
    if (!entry && (!createRequestRef.current || createRequestRef.current.signature !== signature)) {
      createRequestRef.current = { signature, key: crypto.randomUUID() }
    }

    savingRef.current = true
    setSaving(true)
    try {
      await apiSend('/api/cloak/campaigns', 'POST', {
        id: entry?.id ?? entry?.campaignId,
        campaignId: entry?.campaignId ?? entry?.id,
        slug,
        _originalSlug: entry?.slug,
        _createOnly: !entry,
        _baseUpdatedAt: entry?.updatedAt,
        _createKey: entry ? undefined : createRequestRef.current?.key,
        nome: nome.trim(),
        offerUrl: offerUrl.trim(),
        whitePageUrl: whitePageUrl.trim(),
        dominio: dominio.trim(),
        trafficSource,
        enabled,
        shadowMode,
        mobileOnly,
        requireAdClick: false,
        sensitivity,
        paises,
        idiomas,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const previewSlug = normalizePublicSlug(slug) || 'seu-link'
  const previewHost = dominio || domainsData?.appHost || 'seu-dominio.com'
  const previewUrl = `https://${previewHost}/${previewSlug}`

  const inputCls =
    'h-11 w-full rounded-lg border border-border bg-secondary/35 px-3 text-sm text-foreground placeholder:text-muted-foreground transition-colors focus:border-[color:var(--brand-cyan)] focus:outline-none focus:ring-2 focus:ring-brand-cyan/10'
  const labelCls = 'mb-1.5 block text-sm font-medium text-foreground'
  const hintCls = 'text-xs leading-relaxed text-muted-foreground'

  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={entry ? 'Editar link protegido' : 'Novo link protegido'}
        className="drawer-in h-full w-full max-w-xl overflow-y-auto border-l border-border bg-card shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-card px-6 py-4">
          <div>
            <h2 className="text-base font-semibold text-foreground">{entry ? 'Editar link protegido' : 'Novo link protegido'}</h2>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Defina os destinos e o comportamento específico deste link.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-8 px-6 py-6">
          <section aria-labelledby="cloak-entry-destinations" className="space-y-5">
            <div>
              <h3 id="cloak-entry-destinations" className="text-sm font-semibold text-foreground">Identificação e destinos</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Defina como identificar o link e para onde cada tipo de acesso será enviado.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-nome">Nome do link</label>
              <input id="ck-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Campanha BR - Oferta X" />
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-slug">Endereço do link</label>
              <div className="flex gap-2">
                <input
                  id="ck-slug"
                  className={inputCls}
                  value={slug}
                  onChange={(e) => setSlug(normalizePublicSlug(e.target.value))}
                  placeholder="x78dfa7s"
                />
                <button
                  type="button"
                  onClick={() => setSlug(randomPublicSlug())}
                  className="grid size-11 shrink-0 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                  aria-label="Gerar outro endereço"
                  title="Gerar outro endereço"
                >
                  <RefreshCw className="size-4" />
                </button>
              </div>
              <p className="mt-2 break-all text-xs font-medium text-[color:var(--brand-cyan)]">{previewUrl}</p>
              {entry && previewSlug !== entry.slug && (
                <p className="mt-2 text-xs leading-relaxed text-warning">
                  Alterar o endereço pode fazer links já publicados pararem de funcionar. O endereço anterior não vira alias automaticamente.
                </p>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-offer">Destino principal</label>
              <p className={`${hintCls} mb-2`}>Para onde os acessos liberados serão enviados.</p>
              <input id="ck-offer" className={inputCls} value={offerUrl} onChange={(e) => setOfferUrl(e.target.value)} placeholder="https://minha-oferta.com" />
              {/^https:\/\//.test(offerUrl.trim()) && (
                <a
                  href={offerUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--brand-cyan)] hover:underline"
                >
                  <ExternalLink className="size-3" /> Ver
                </a>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-white">Destino seguro</label>
              <p className={`${hintCls} mb-2`}>
                Deixe vazio para usar o destino seguro padrão configurado em Regras. Se não houver um padrão, o ROI-NADOS usa a página neutra.
              </p>
              <input id="ck-white" className={inputCls} value={whitePageUrl} onChange={(e) => setWhitePageUrl(e.target.value)} placeholder="https://pagina-segura.com" />

              {/^https:\/\//.test(whitePageUrl.trim()) && (
                <a
                  href={whitePageUrl.trim()}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-[color:var(--brand-cyan)] hover:underline"
                >
                  <ExternalLink className="size-3" /> Ver
                </a>
              )}

              {whitePageUrl.trim() === '' && globalConfig && (
                <p className="mt-2 break-all text-xs leading-relaxed text-muted-foreground">
                  {globalSafePage
                    ? <>Usará o destino seguro padrão: <span className="text-foreground">{globalSafePage}</span></>
                    : 'Usará a página neutra do ROI-NADOS.'}
                </p>
              )}
              {whitePageUrl.trim() === '' && !globalConfig && (
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Se permanecer vazio, o link herdará o destino seguro padrão de Regras.</p>
              )}

              {whitePageUrl.trim() !== '' && !/^https:\/\//.test(whitePageUrl.trim()) && (
                <p className="mt-2 text-xs leading-relaxed text-warning">
                  Use uma URL https:// válida ou deixe o campo vazio para herdar o destino seguro padrão.
                </p>
              )}

              {/^https:\/\//.test(offerUrl.trim()) && /^https:\/\//.test(whitePageUrl.trim()) && (
                <button
                  type="button"
                  onClick={() => {
                    window.open(offerUrl.trim(), '_blank', 'noopener,noreferrer')
                    window.open(whitePageUrl.trim(), '_blank', 'noopener,noreferrer')
                  }}
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ExternalLink className="size-3" /> Abrir os dois destinos
                </button>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-dom">Domínio</label>
              {verifiedDomains.length === 0 && !dominio ? (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Nenhum domínio dedicado ao Cloaker está pronto. Cadastre ou ajuste um domínio em <span className="font-medium text-foreground">Domínios</span> antes de criar a campanha.
                </p>
              ) : (
                <select id="ck-dom" className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                  <option value="">Selecione um domínio Cloaker</option>
                  {verifiedDomains.map((d) => (
                    <option key={d.host} value={d.host}>{d.host}</option>
                  ))}
                  {dominio && !currentInList && <option value={dominio}>{dominio} (não verificado)</option>}
                </select>
              )}
              {dominio && !currentInList && (
                <p className="mt-2 text-xs leading-relaxed text-warning">
                  Este domínio não está pronto para novas campanhas. Use um domínio verificado e configurado como Cloaker.
                </p>
              )}
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-source">Fonte de tráfego</label>
              <p className={`${hintCls} mb-2`}>Define os parâmetros prontos para colar no anúncio.</p>
              <select
                id="ck-source"
                className={inputCls}
                value={trafficSource}
                onChange={(e) => setTrafficSource(e.target.value as 'tiktok_standard' | 'tiktok_smart_plus' | 'custom')}
              >
                <option value="tiktok_standard">TikTok Standard</option>
                <option value="tiktok_smart_plus">TikTok Smart+</option>
                <option value="custom">Personalizada</option>
              </select>
            </div>
          </section>

          <section aria-labelledby="cloak-entry-protection" className="border-t border-border/60 pt-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h3 id="cloak-entry-protection" className="text-sm font-semibold text-foreground">Proteção deste link</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {enabled
                    ? 'A proteção avalia os acessos e pode enviá-los ao destino seguro.'
                    : 'Todos os acessos seguem diretamente para o destino principal.'}
                </p>
              </div>
              <Switch checked={enabled} onChange={setEnabled} label="Proteção deste link" />
            </div>

            <fieldset className="mt-5">
              <legend className="text-sm font-medium text-foreground">Quando este link detectar um acesso suspeito</legend>
              {!enabled && <p className="mt-1 text-xs text-muted-foreground">Esta escolha será usada quando a proteção estiver ativa.</p>}
              <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
                <label className="flex cursor-pointer items-start gap-3 py-3.5">
                  <input
                    type="radio"
                    name="cloak-entry-behavior"
                    checked={shadowMode !== true}
                    onChange={() => setShadowMode(false)}
                    className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Enviar para o destino seguro</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">A proteção redireciona o acesso suspeito.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 py-3.5">
                  <input
                    type="radio"
                    name="cloak-entry-behavior"
                    checked={shadowMode === true}
                    onChange={() => setShadowMode(true)}
                    className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Somente observar</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">Classifica o acesso, mas mantém o destino principal.</span>
                  </span>
                </label>
              </div>
            </fieldset>

            {globalShadowMode && !shadowMode && (
              <p className="mt-3 text-xs leading-relaxed text-warning">
                O modo observação global está ativo. Enquanto ele permanecer ligado, este link também apenas observará, mesmo com “Enviar para o destino seguro” selecionado aqui.
              </p>
            )}

            <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">Comportamento efetivo · </span>
              {!enabled
                ? 'proteção desativada · todos → principal'
                : effectiveShadowMode
                  ? 'somente observação · todos permanecem no principal'
                  : 'proteção ativa · suspeitos → destino seguro'}
            </p>
          </section>

          <fieldset className="border-t border-border/60 pt-6">
            <legend className="text-sm font-semibold text-foreground">Sensibilidade</legend>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              Define o nível de evidência necessário para considerar um acesso suspeito.
            </p>

            <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
              {sensitivity === 'custom' && (
                <label className="flex items-start gap-3 py-3.5">
                  <input type="radio" name="cloak-entry-sensitivity" checked readOnly className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]" />
                  <span>
                    <span className="block text-sm font-medium text-foreground">Personalizada · limite {customThreshold}</span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                      Configuração personalizada existente. Escolha um dos perfis abaixo para substituí-la.
                    </span>
                  </span>
                </label>
              )}
              {SENSITIVITIES.map((item) => (
                <label key={item.value} className="flex cursor-pointer items-start gap-3 py-3.5">
                  <input
                    type="radio"
                    name="cloak-entry-sensitivity"
                    checked={sensitivity === item.value}
                    onChange={() => setSensitivity(item.value)}
                    className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>

            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              {sensitivity === 'custom'
                ? `Configuração personalizada preservada · limite ${effectiveThreshold}.`
                : selectedSensitivity?.desc}
            </p>
          </fieldset>

          <details
            className="group border-y border-border/60 py-4"
            open={segmentationOpen}
            onToggle={(e) => setSegmentationOpen(e.currentTarget.open)}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/20">
              <span>
                <span className="block text-sm font-semibold text-foreground">
                  Segmentação opcional{segmentBits.length > 0 ? ` · ${segmentBits.join(' · ')}` : ''}
                </span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Sem restrições, qualquer país, idioma ou dispositivo pode acessar.
                </span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>

            <div className="mt-5 space-y-5">
              <fieldset>
                <legend className="text-sm font-medium text-foreground">Dispositivo</legend>
                <div className="mt-2 divide-y divide-border/60 border-y border-border/60">
                  <label className="flex cursor-pointer items-center gap-3 py-3">
                    <input
                      type="radio"
                      name="cloak-entry-device"
                      checked={!mobileOnly}
                      onChange={() => setMobileOnly(false)}
                      className="size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                    />
                    <span className="text-sm text-foreground">Qualquer dispositivo</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-3 py-3">
                    <input
                      type="radio"
                      name="cloak-entry-device"
                      checked={mobileOnly}
                      onChange={() => setMobileOnly(true)}
                      className="size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                    />
                    <span className="text-sm text-foreground">Somente mobile</span>
                  </label>
                </div>
              </fieldset>

              <div>
                <label className={labelCls} htmlFor="ck-paises">Países permitidos</label>
                <GeoMultiSelect
                  id="ck-paises"
                  value={paises}
                  onChange={setPaises}
                  options={COUNTRY_OPTIONS}
                  normalize={(s) => s.trim().toUpperCase()}
                  labelFor={labelForCountry}
                  emptyLabel="Sem restrição de país"
                  placeholder="Buscar país (ex.: Brasil)"
                  manualPattern={/^[A-Za-z]{2}$/}
                  flags
                />
              </div>

              <div>
                <label className={labelCls} htmlFor="ck-idiomas">Idiomas permitidos</label>
                <GeoMultiSelect
                  id="ck-idiomas"
                  value={idiomas}
                  onChange={setIdiomas}
                  options={LANGUAGE_OPTIONS}
                  normalize={(s) => s.trim().toLowerCase()}
                  labelFor={labelForLanguage}
                  emptyLabel="Sem restrição de idioma"
                  placeholder="Buscar idioma (ex.: Português)"
                  manualPattern={/^[A-Za-z]{2}$/}
                />
              </div>
            </div>
          </details>

          {error && <p className="text-sm leading-relaxed text-destructive">{error}</p>}
        </div>

        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card px-6 py-4">
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
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/30 disabled:opacity-50"
          >
            {saving && <Loader2 className="size-3.5 animate-spin" />}
            {entry ? 'Salvar' : 'Criar link'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
