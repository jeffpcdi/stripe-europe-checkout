'use client'

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { ApiError, apiSend, useCloakConfig, useHealth } from '@/lib/api'
import type { CloakConfig, CloakSensitivity } from '@/lib/types'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/lib/toast'

// Camadas de detecção expostas na UI — rótulo + descrição curta.
const LAYERS: { key: keyof CloakConfig; label: string; hint: string }[] = [
  { key: 'blockDatacenter', label: 'Bloquear datacenter', hint: 'ASN de nuvem e infraestrutura automatizada' },
  { key: 'blockHeadless', label: 'Bloquear headless', hint: 'navegador automatizado + Client Hints' },
  { key: 'checkHeaders', label: 'Headers obrigatórios', hint: 'Sec-Fetch e cabeçalhos de browser real' },
  { key: 'requireJsChallenge', label: 'Challenge JS', hint: 'token HMAC executado no cliente' },
  { key: 'checkWebgl', label: 'WebGL renderer', hint: 'detecta SwiftShader / GPU emulada' },
  { key: 'checkTimezone', label: 'Timezone vs IP', hint: 'fuso IANA coerente com a geo' },
  { key: 'checkBehavior', label: 'Biometria', hint: 'padrão de mouse/scroll humano' },
  { key: 'blockZhLang', label: 'Integridade de idioma', hint: 'detecta cabeçalho de idioma sintetizado' },
  { key: 'checkWebview', label: 'Integridade webview', hint: 'UA in-app vs globals do JS' },
  { key: 'checkCoherence', label: 'Coerência de device', hint: 'plataforma/hardware x UA/geo' },
  { key: 'checkEntropy', label: 'Entropia de ação', hint: 'movimento e ação sem trilha' },
]

const SENSITIVITY: { id: CloakSensitivity; label: string; hint: string; tradeoff: string }[] = [
  {
    id: 'strict',
    label: 'Rígida',
    hint: 'Mais proteção · limite 30',
    tradeoff: 'Mais proteção, com maior chance de desviar alguns usuários legítimos.',
  },
  {
    id: 'balanced',
    label: 'Equilibrada',
    hint: 'Recomendada · limite 40',
    tradeoff: 'Equilíbrio recomendado entre proteção e conversão.',
  },
  {
    id: 'loose',
    label: 'Leve',
    hint: 'Reduz falsos positivos · limite 55',
    tradeoff: 'Menos falsos positivos, com maior tolerância a tráfego suspeito.',
  },
  {
    id: 'custom',
    label: 'Personalizada',
    hint: 'Defina o limite manualmente',
    tradeoff: 'Você controla exatamente o limite de suspeita entre 10 e 90.',
  },
]

// Item 168: estas camadas dependem do challengeData coletado pelo snippet /t.js.
const CHALLENGE_DEPENDENT: { key: keyof CloakConfig; label: string }[] = [
  { key: 'checkWebgl', label: 'WebGL renderer' },
  { key: 'checkTimezone', label: 'Timezone vs IP' },
  { key: 'checkBehavior', label: 'Biometria' },
  { key: 'checkEntropy', label: 'Entropia de ação' },
]

const inputClass =
  'h-10 rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15'

function DetectionToggle({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint: string
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-4 py-3.5">
      <div className="min-w-0 pr-2">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onChange={onChange} label={label} />
    </div>
  )
}

export function CloakConfigPanel() {
  const { data, mutate } = useCloakConfig()
  const { data: health } = useHealth() // item 255: velocity distribuído exige Redis
  const [draft, setDraft] = useState<CloakConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [draftBaseUpdatedAt, setDraftBaseUpdatedAt] = useState<string | null>(null)
  const [remoteChanged, setRemoteChanged] = useState(false)

  // Mantém o draft sincronizado enquanto não há edição local. Se outra aba
  // salvar no meio de uma edição, preservamos o que o usuário digitou, mas a
  // revisão capturada no PRIMEIRO toque continua sendo enviada ao backend.
  useEffect(() => {
    if (!data) return
    const incomingVersion = data.configUpdatedAt ?? null
    if (!draft || !dirty) {
      setDraft(data)
      setDraftBaseUpdatedAt(incomingVersion)
      setRemoteChanged(false)
      return
    }
    if (draftBaseUpdatedAt && incomingVersion && draftBaseUpdatedAt !== incomingVersion) {
      setRemoteChanged(true)
    }
  }, [data, draft, dirty, draftBaseUpdatedAt])

  const cfg = draft ?? data
  if (!cfg) {
    return (
      <section aria-busy="true" aria-label="Carregando configuração do Cloaker" className="space-y-5">
        <div className="space-y-2">
          <div className="h-5 w-36 rounded bg-secondary/70" />
          <div className="h-4 w-72 max-w-full rounded bg-secondary/45" />
        </div>
        <div className="h-12 rounded-lg border border-border/50 bg-secondary/20" />
        <div className="space-y-3 border-y border-border/50 py-3">
          <div className="h-8 rounded bg-secondary/25" />
          <div className="h-8 rounded bg-secondary/25" />
        </div>
        <div className="h-10 rounded-lg border border-border/50 bg-secondary/20" />
      </section>
    )
  }

  function patch(p: Partial<CloakConfig>) {
    if (!dirty) setDraftBaseUpdatedAt(data?.configUpdatedAt ?? null)
    setSavedAt(null)
    setDirty(true)
    setRemoteChanged(false)
    setDraft((d) => ({ ...(d ?? (data as CloakConfig)), ...p }))
  }

  async function reloadRemote() {
    const latest = await mutate()
    if (latest) {
      setDraft(latest)
      setDraftBaseUpdatedAt(latest.configUpdatedAt ?? null)
    }
    setDirty(false)
    setRemoteChanged(false)
  }

  async function handleSave() {
    if (!draft || saving) return
    setSaving(true)
    try {
      const saved = await apiSend<{ ok: boolean; cloak: CloakConfig }>('/api/cloak-config', 'POST', {
        ...draft,
        _baseUpdatedAt: draftBaseUpdatedAt || undefined,
      })
      // O backend sanitiza/clampa alguns valores. A tela passa a refletir
      // exatamente a configuração confirmada, em vez de manter um draft que
      // pode divergir do que realmente foi persistido.
      const confirmed = saved.cloak ?? draft
      setDraft(confirmed)
      setDraftBaseUpdatedAt(confirmed.configUpdatedAt ?? null)
      setDirty(false)
      setRemoteChanged(false)
      await mutate(confirmed, { revalidate: false })
      setSavedAt(Date.now())
      setTimeout(() => setSavedAt(null), 2000)
      toast.success('Proteção atualizada')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setRemoteChanged(true)
        await mutate()
      }
      toast.error('Não foi possível salvar a proteção', {
        hint: err instanceof Error ? err.message : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  const selectedSensitivity =
    SENSITIVITY.find((item) => item.id === (cfg.sensitivity ?? 'balanced')) ?? SENSITIVITY[1]

  return (
    <section className="[&_[role=switch]]:shadow-none">
      <header className="mb-6">
        <h2 className="text-base font-semibold text-foreground">Proteção global</h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          Defina como os links protegidos tratam acessos considerados suspeitos.
        </p>
      </header>

      <div className="space-y-7">
        <section aria-labelledby="cloak-protection-state">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 id="cloak-protection-state" className="text-sm font-medium text-foreground">Proteção</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{cfg.enabled ? 'Ativa' : 'Desligada'}</p>
            </div>
            <Switch checked={cfg.enabled} onChange={(v) => patch({ enabled: v })} label="Cloaking ativado" />
          </div>

          <p
            className={`mt-3 text-sm leading-relaxed ${
              !cfg.enabled || cfg.shadowMode ? 'text-warning' : 'text-muted-foreground'
            }`}
          >
            {!cfg.enabled
              ? 'Proteção desligada · todos os acessos seguem para o destino principal.'
              : cfg.shadowMode
                ? 'Modo observação · os acessos são classificados, mas não são redirecionados.'
                : 'Acessos considerados suspeitos seguem para o destino seguro.'}
          </p>
        </section>

        <fieldset>
          <legend className="text-sm font-medium text-foreground">Quando um acesso for considerado suspeito</legend>
          {!cfg.enabled && (
            <p className="mt-1 text-xs text-muted-foreground">Esta escolha será usada quando a proteção estiver ativa.</p>
          )}
          <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
            <label className="flex cursor-pointer items-start gap-3 py-3.5">
              <input
                type="radio"
                name="cloak-behavior"
                checked={cfg.shadowMode !== true}
                onChange={() => patch({ shadowMode: false })}
                className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Enviar para o destino seguro</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  A proteção redireciona o acesso suspeito.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 py-3.5">
              <input
                type="radio"
                name="cloak-behavior"
                checked={cfg.shadowMode === true}
                onChange={() => patch({ shadowMode: true })}
                className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
              />
              <span>
                <span className="block text-sm font-medium text-foreground">Somente observar</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                  Classifica o acesso, mas mantém o destino principal.
                </span>
              </span>
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium text-foreground">Sensibilidade</legend>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Limites menores tornam a proteção mais sensível; limites maiores reduzem falsos positivos.
          </p>

          <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
            {SENSITIVITY.map((item) => {
              const active = (cfg.sensitivity ?? 'balanced') === item.id
              return (
                <label key={item.id} className="flex cursor-pointer items-start gap-3 py-3">
                  <input
                    type="radio"
                    name="cloak-sensitivity"
                    checked={active}
                    onChange={() => patch({ sensitivity: item.id })}
                    className="mt-1 size-4 shrink-0 accent-[color:var(--brand-cyan)]"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.hint}</span>
                  </span>
                </label>
              )
            })}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selectedSensitivity.tradeoff}</p>

          {cfg.sensitivity === 'custom' && (
            <label className="mt-4 block max-w-xs">
              <span className="text-sm font-medium text-foreground">Limite de suspeita</span>
              <input
                type="number"
                min={10}
                max={90}
                value={cfg.threshold}
                onChange={(e) => patch({ threshold: Number(e.target.value) })}
                className={`${inputClass} mt-2 w-28`}
              />
              <span className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                Quanto menor o limite, mais sensível é a proteção. Intervalo: 10–90.
              </span>
            </label>
          )}
        </fieldset>

        <label className="block">
          <span className="text-sm font-medium text-foreground">Destino seguro padrão</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            Usado quando um link protegido não possui destino seguro próprio. Deixe vazio para usar a página neutra do ROI-NADOS.
          </span>
          <input
            value={cfg.defaultWhitePage ?? ''}
            onChange={(e) => patch({ defaultWhitePage: e.target.value })}
            placeholder="https://pagina-segura.com"
            className={`${inputClass} mt-2 w-full`}
          />
          {(cfg.defaultWhitePage ?? '').trim() !== '' && !/^https:\/\//.test((cfg.defaultWhitePage ?? '').trim()) && (
            <span className="mt-2 block text-xs leading-relaxed text-warning">
              Use uma URL https:// válida ou deixe o campo vazio para usar a página neutra.
            </span>
          )}
        </label>

        <details className="group border-y border-border/60 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25">
            <span>
              <span className="block text-sm font-semibold text-foreground">Configurações avançadas</span>
              <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">
                Limites por IP, bloqueios recorrentes e camadas técnicas de detecção.
              </span>
            </span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>

          <div className="mt-5 space-y-6">
            <section>
              <h3 className="text-sm font-medium text-foreground">Limite de acessos por IP</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Aplica a política de proteção quando o mesmo IP ultrapassa o volume configurado dentro da janela.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="text-xs font-medium text-muted-foreground">Acessos na janela</span>
                  <input
                    type="number"
                    min={3}
                    max={100}
                    value={cfg.velocityLimit ?? 12}
                    onChange={(e) => patch({ velocityLimit: Number(e.target.value) })}
                    className={`${inputClass} mt-1.5 w-full`}
                    aria-label="Máximo de acessos do mesmo IP na janela"
                  />
                </label>
                <label>
                  <span className="text-xs font-medium text-muted-foreground">Janela</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      type="number"
                      min={10}
                      max={600}
                      value={cfg.velocityWindowSec ?? 60}
                      onChange={(e) => patch({ velocityWindowSec: Number(e.target.value) })}
                      className={`${inputClass} min-w-0 flex-1`}
                      aria-label="Janela de contagem em segundos"
                    />
                    <span className="text-xs text-muted-foreground">segundos</span>
                  </div>
                </label>
              </div>
              {health && !health.redis && (
                <p className="mt-3 text-xs leading-relaxed text-warning">
                  Sem Redis, este limite é contado separadamente em cada instância do servidor.
                </p>
              )}
            </section>

            <section className="border-t border-border/60 pt-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h3 className="text-sm font-medium text-foreground">Bloqueio automático por anúncio</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    Bloqueia temporariamente o mesmo IP quando ele acumula acessos de alto risco no mesmo anúncio.
                  </p>
                </div>
                <Switch
                  checked={cfg.autoBlockEnabled === true}
                  onChange={(value) => patch({ autoBlockEnabled: value })}
                  label="Bloqueio automático"
                />
              </div>

              {cfg.autoBlockEnabled === true && (
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <label>
                    <span className="text-xs font-medium text-muted-foreground">Acessos suspeitos</span>
                    <input
                      type="number"
                      min={3}
                      max={100}
                      value={cfg.autoBlockThreshold ?? 8}
                      onChange={(event) => patch({ autoBlockThreshold: Number(event.target.value) })}
                      className={`${inputClass} mt-1.5 w-full`}
                    />
                  </label>
                  <label>
                    <span className="text-xs font-medium text-muted-foreground">Janela de análise</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        min={5}
                        max={1440}
                        value={cfg.autoBlockWindowMin ?? 30}
                        onChange={(event) => patch({ autoBlockWindowMin: Number(event.target.value) })}
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                      <span className="text-xs text-muted-foreground">min</span>
                    </div>
                  </label>
                  <label>
                    <span className="text-xs font-medium text-muted-foreground">Duração do bloqueio</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={720}
                        value={cfg.autoBlockTtlHours ?? 24}
                        onChange={(event) => patch({ autoBlockTtlHours: Number(event.target.value) })}
                        className={`${inputClass} min-w-0 flex-1`}
                      />
                      <span className="text-xs text-muted-foreground">horas</span>
                    </div>
                  </label>
                </div>
              )}
            </section>

            <section className="border-t border-border/60 pt-5">
              <h3 className="text-sm font-medium text-foreground">Camadas de detecção</h3>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Ajustes técnicos do motor. As configurações padrão atendem à maioria das operações.
              </p>

              <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
                {LAYERS.map((layer) => (
                  <div key={layer.key} className="border-t border-border/50 first:border-t-0 sm:[&:nth-child(-n+2)]:border-t-0">
                    <DetectionToggle
                      checked={cfg[layer.key] as boolean}
                      onChange={(value) => patch({ [layer.key]: value } as Partial<CloakConfig>)}
                      label={layer.label}
                      hint={layer.hint}
                    />
                  </div>
                ))}
              </div>

              {!cfg.requireJsChallenge &&
                (() => {
                  const inertes = CHALLENGE_DEPENDENT.filter((layer) => cfg[layer.key] as boolean)
                  if (!inertes.length) return null
                  const names = inertes.map((layer) => layer.label).join(', ')
                  return (
                    <p className="mt-3 text-xs leading-relaxed text-warning">
                      {names} {inertes.length > 1 ? 'estão sem efeito' : 'está sem efeito'} porque o Challenge JS está desligado.
                    </p>
                  )
                })()}
            </section>
          </div>
        </details>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="min-w-0">
            {remoteChanged ? (
              <p className="text-xs leading-relaxed text-warning">
                Esta configuração foi alterada em outra sessão. Recarregue para continuar.
              </p>
            ) : dirty ? (
              <p className="text-xs text-muted-foreground">Alterações não salvas</p>
            ) : savedAt ? (
              <p className="text-xs text-success">Configuração salva</p>
            ) : null}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {remoteChanged && (
              <button type="button" onClick={() => void reloadRemote()} className="btn-secondary px-3 py-2 text-sm">
                Recarregar
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !dirty || remoteChanged}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-brand-cyan px-4 text-sm font-semibold text-slate-950 transition-colors hover:bg-brand-cyan/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/35 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {saving ? 'Salvando…' : savedAt ? 'Salvo ✓' : 'Salvar'}
            </button>
          </div>
        </footer>
      </div>
    </section>
  )
}
