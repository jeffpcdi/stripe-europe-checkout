'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Loader2, ShieldAlert, Scale, ShieldOff, Check, ExternalLink } from 'lucide-react'
import { apiSend, useDomains } from '@/lib/api'
import type { CloakEntry, CloakSensitivity } from '@/lib/types'
import { GeoMultiSelect } from './geo-multi-select'
import {
  COUNTRY_OPTIONS,
  LANGUAGE_OPTIONS,
  labelForCountry,
  labelForLanguage,
} from '@/lib/geo-options'
import type { LucideIcon } from 'lucide-react'

// Sensibilidade explicada em linguagem de negócio — o usuário entende o efeito
// (proteção x risco de perder acesso real) sem precisar saber de "threshold".
const SENSITIVITIES: {
  value: Exclude<CloakSensitivity, 'custom'>
  label: string
  tag: string
  desc: string
  icon: LucideIcon
}[] = [
  {
    value: 'strict',
    label: 'Rígido',
    tag: 'Mais proteção',
    desc: 'Desvia ao menor sinal suspeito. Máxima defesa contra revisores de anúncio, mas pode mandar alguns usuários reais para a página branca.',
    icon: ShieldAlert,
  },
  {
    value: 'balanced',
    label: 'Equilibrado',
    tag: 'Recomendado',
    desc: 'Melhor equilíbrio: protege a offer dos revisores e mantém os acessos legítimos passando para a oferta.',
    icon: Scale,
  },
  {
    value: 'loose',
    label: 'Frouxo',
    tag: 'Menos proteção',
    desc: 'Só desvia bots muito óbvios. Praticamente nenhum falso positivo, porém deixa passar revisores mais disfarçados.',
    icon: ShieldOff,
  },
]

// Item 141: threshold efetivo por sensibilidade (espelha SENSITIVITY_THRESHOLDS
// do bot-filter.js) — mostra ao usuário o número que a escolha de fato aplica.
const EFFECTIVE_THRESHOLD: Record<string, number> = { strict: 30, balanced: 40, loose: 55 }

interface Props {
  entry: CloakEntry | null
  onClose: () => void
  onSaved: () => void
}

export function CloakEntryEditor({ entry, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(entry?.nome ?? '')
  const [offerUrl, setOfferUrl] = useState(entry?.offerUrl ?? '')
  const [whitePageUrl, setWhitePageUrl] = useState(entry?.whitePageUrl ?? '')
  const [dominio, setDominio] = useState(entry?.dominio ?? '')
  const [enabled, setEnabled] = useState(entry?.enabled ?? true)
  const [mobileOnly, setMobileOnly] = useState(entry?.mobileOnly ?? true)
  const [requireAdClick, setRequireAdClick] = useState(entry?.requireAdClick ?? true)
  const [sensitivity, setSensitivity] = useState<CloakSensitivity>(entry?.sensitivity ?? 'balanced')
  const [paises, setPaises] = useState<string[]>(entry?.paises ?? [])
  const [idiomas, setIdiomas] = useState<string[]>(entry?.idiomas ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // O modal é renderizado via portal no <body>. Sem isso ele fica preso dentro
  // do GlassCard pai, que tem backdrop-filter (blur) — e backdrop-filter cria um
  // containing block para position:fixed, impedindo o overlay de cobrir a tela.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Só domínios já verificados podem servir o cloaking — um domínio pendente
  // devolve 404 nos links /go. Listamos apenas os verificados para seleção.
  const { data: domainsData } = useDomains()
  const verifiedDomains = (domainsData?.domains ?? []).filter((d) => d.verificado)
  const currentInList = verifiedDomains.some((d) => d.host === dominio)

  async function handleSave() {
    setError(null)
    if (!nome.trim() && !entry) return setError('Dê um nome ao link')
    if (!/^https:\/\//.test(offerUrl.trim())) return setError('A offer precisa ser uma URL https:// válida')
    setSaving(true)
    try {
      await apiSend('/api/cloak/entries', 'POST', {
        slug: entry?.slug,
        nome: nome.trim(),
        offerUrl: offerUrl.trim(),
        whitePageUrl: whitePageUrl.trim(),
        dominio: dominio.trim(),
        enabled,
        mobileOnly,
        requireAdClick,
        sensitivity,
        paises,
        idiomas,
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none'
  const labelCls = 'mb-1 block text-xs font-medium text-foreground'
  const hintCls = 'mb-1.5 text-[11px] leading-relaxed text-muted-foreground'

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho fixo */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-6 py-4 backdrop-blur">
          <h2 className="text-base font-semibold text-foreground">
            {entry ? 'Editar link de cloaking' : 'Novo link de cloaking'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-6 px-6 py-5">
          {/* ── Seção: básico ── */}
          <section className="flex flex-col gap-4">
            <div>
              <label className={labelCls} htmlFor="ck-nome">Nome do link</label>
              <input id="ck-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Campanha BR - Oferta X" />
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-offer">Offer (página real, https)</label>
              <input id="ck-offer" className={inputCls} value={offerUrl} onChange={(e) => setOfferUrl(e.target.value)} placeholder="https://minha-oferta.com" />
              <p className="mt-1 text-[11px] text-muted-foreground">Para onde o usuário real é levado.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-white">Página branca (opcional, https)</label>
              <input id="ck-white" className={inputCls} value={whitePageUrl} onChange={(e) => setWhitePageUrl(e.target.value)} placeholder="https://pagina-segura.com" />
              <div className="mt-1 flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">Para onde bots e revisores são desviados. Vazio = página neutra embutida.</p>
                {/* Item 138: abrir a white page em nova aba direto do editor */}
                {/^https:\/\//.test(whitePageUrl.trim()) && (
                  <a
                    href={whitePageUrl.trim()}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-[color:var(--brand-cyan)] transition-colors hover:bg-secondary"
                  >
                    <ExternalLink className="size-3" /> Ver
                  </a>
                )}
              </div>
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-dom">Domínio personalizado (opcional)</label>
              {verifiedDomains.length === 0 && !dominio ? (
                <div className="rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
                  Nenhum domínio verificado ainda. Cadastre e verifique um domínio em{' '}
                  <span className="font-medium text-foreground">Domínios</span> para poder selecioná-lo aqui.
                </div>
              ) : (
                <select id="ck-dom" className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                  <option value="">Padrão (domínio principal do app)</option>
                  {verifiedDomains.map((d) => (
                    <option key={d.host} value={d.host}>{d.host}</option>
                  ))}
                  {dominio && !currentInList && (
                    <option value={dominio}>{dominio} (não verificado)</option>
                  )}
                </select>
              )}
              {/* Item 140: aviso quando o domínio selecionado não está verificado —
                  o /c/:slug responde 404 nesse host até o DNS apontar pra cá */}
              {dominio && !currentInList && (
                <p className="mt-1.5 flex items-start gap-1.5 rounded-lg border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-3 py-2 text-[11px] text-foreground">
                  <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
                  <span>
                    <strong>{dominio}</strong> ainda não está verificado — o link <code>/c/{'{slug}'}</code> só vai
                    responder neste domínio depois que o DNS apontar pra cá. Verifique em <strong>Domínios</strong> ou
                    use o domínio principal do app.
                  </span>
                </p>
              )}
            </div>
          </section>

          {/* ── Seção: sensibilidade ── */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-foreground">Sensibilidade da detecção</h3>
            <p className={hintCls}>
              Define o quão agressivo o filtro é ao decidir quem vê a página branca.{' '}
              {/* Item 141: threshold efetivo herdado da sensibilidade escolhida */}
              <span className="text-foreground">
                Score ≥ <strong>{EFFECTIVE_THRESHOLD[sensitivity] ?? 40}</strong> é tratado como bot.
              </span>
            </p>
            <div className="flex flex-col gap-2">
              {SENSITIVITIES.map((s) => {
                const active = sensitivity === s.value
                const Icon = s.icon
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => setSensitivity(s.value)}
                    aria-pressed={active}
                    className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-all ${
                      active
                        ? 'border-[color:var(--brand-cyan)] bg-[var(--accent-light)] shadow-[var(--glow-cyan-soft)]'
                        : 'border-border bg-secondary/40 hover:bg-secondary'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${
                        active ? 'text-[color:var(--brand-cyan)]' : 'text-muted-foreground'
                      }`}
                      style={active ? { background: 'color-mix(in oklab, var(--brand-cyan) 16%, transparent)' } : undefined}
                      aria-hidden="true"
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{s.label}</span>
                        <span
                          className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                            s.value === 'balanced'
                              ? 'bg-[var(--accent-light)] text-[color:var(--brand-cyan)]'
                              : 'bg-secondary text-muted-foreground'
                          }`}
                        >
                          {s.tag}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">{s.desc}</span>
                    </span>
                    {active && <Check className="mt-0.5 size-4 shrink-0 text-[color:var(--brand-cyan)]" aria-hidden="true" />}
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── Seção: segmentação ── */}
          <section className="flex flex-col gap-4">
            <div>
              <h3 className="mb-1 text-sm font-semibold text-foreground">Onde a offer é liberada</h3>
              <p className={hintCls}>Deixe vazio para liberar em qualquer lugar. Quem estiver fora vê a página branca.</p>
            </div>

            <div>
              <label className={labelCls} htmlFor="ck-paises">Países permitidos</label>
              <GeoMultiSelect
                id="ck-paises"
                value={paises}
                onChange={setPaises}
                options={COUNTRY_OPTIONS}
                normalize={(s) => s.trim().toUpperCase()}
                labelFor={labelForCountry}
                emptyLabel="Todos os países"
                placeholder="Buscar país (ex.: Brasil)"
                manualPattern={/^[A-Za-z]{2}$/}
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
                emptyLabel="Todos os idiomas"
                placeholder="Buscar idioma (ex.: Português)"
                manualPattern={/^[A-Za-z]{2}$/}
              />
            </div>
          </section>

          {/* ── Seção: regras ── */}
          <section className="flex flex-col gap-2 border-t border-border pt-5">
            <ToggleRow label="Link ativo" hint="Desligado, o link não redireciona ninguém" checked={enabled} onChange={setEnabled} />
            <ToggleRow label="Apenas mobile" hint="Bloqueia acessos de desktop (revisores costumam usar desktop)" checked={mobileOnly} onChange={setMobileOnly} />
            <ToggleRow label="Exigir clique de anúncio" hint="Só libera quem chega com parâmetro de ad-click válido" checked={requireAdClick} onChange={setRequireAdClick} />
          </section>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Rodapé fixo */}
        <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-card/95 px-6 py-4 backdrop-blur">
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
            className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
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

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-[color:var(--brand-cyan)]' : 'bg-secondary'}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}
