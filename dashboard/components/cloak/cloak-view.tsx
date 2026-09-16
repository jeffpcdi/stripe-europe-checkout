'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import { apiSend, useCloakTestProfiles } from '@/lib/api'
import type { CloakTestResult } from '@/lib/types'
import { CloakConfigPanel } from './cloak-config-panel'
import { CloakStatsPanel } from './cloak-stats-panel'
import { CloakEntriesPanel } from './cloak-entries-panel'
import { describeSignal, LAYER_META, type SignalLayer } from './signal-labels'

type CloakTab = 'overview' | 'rules' | 'traffic'

export function CloakView() {
  const [activeTab, setActiveTab] = useState<CloakTab>('overview')
  const tabClass = 'relative -mb-px min-h-11 shrink-0 border-b-2 border-transparent px-0.5 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-brand-cyan/25 data-[state=active]:border-brand-cyan data-[state=active]:text-foreground'

  useEffect(() => {
    const onTourTab = (event: Event) => {
      const value = (event as CustomEvent<unknown>).detail
      if (value === 'overview' || value === 'rules' || value === 'traffic') setActiveTab(value)
    }
    window.addEventListener('roinados:cloak-tab', onTourTab)
    return () => window.removeEventListener('roinados:cloak-tab', onTourTab)
  }, [])

  return (
    <div className="flex flex-col gap-5">
      <Tabs.Root value={activeTab} onValueChange={(value) => setActiveTab(value as CloakTab)} className="flex flex-col gap-5">
        <Tabs.List className="flex max-w-full items-center gap-6 overflow-x-auto border-b border-border/60" aria-label="Áreas do Cloaker">
          <Tabs.Trigger value="overview" className={tabClass}>Resultados</Tabs.Trigger>
          <Tabs.Trigger value="rules" className={tabClass}>Regras</Tabs.Trigger>
          <Tabs.Trigger value="traffic" className={tabClass}>Links</Tabs.Trigger>
        </Tabs.List>

        <Tabs.Content value="overview" className="outline-none">
          <div data-tour="cloak-stats"><CloakStatsPanel /></div>
        </Tabs.Content>

        <Tabs.Content value="rules" className="outline-none">
          <div className="grid grid-cols-1 gap-8 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)] xl:gap-0">
            <div data-tour="cloak-config" className="min-w-0 xl:pr-6"><CloakConfigPanel /></div>
            <div data-tour="cloak-test" className="min-w-0 xl:border-l xl:border-border/60 xl:pl-6"><CloakTestPanel /></div>
          </div>
        </Tabs.Content>

        <Tabs.Content value="traffic" className="outline-none">
          <div data-tour="cloak-links"><CloakEntriesPanel /></div>
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

const LAYER_ORDER: SignalLayer[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function CloakTestPanel() {
  const [result, setResult] = useState<CloakTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Item 166: preview de threshold — recalcula a prévia localmente sem novo request.
  const [previewThreshold, setPreviewThreshold] = useState<number | null>(null)
  // Perfil sintético opcional. Sem perfil, o teste usa apenas o request HTTP da dashboard.
  const [profile, setProfile] = useState<string>('')
  const { data: profilesData } = useCloakTestProfiles()
  const profiles = profilesData?.profiles ?? []

  async function runTest(profileId = profile) {
    setLoading(true)
    setError(null)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST', profileId ? { profile: profileId } : {})
      setResult(r)
      setPreviewThreshold(r.threshold)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no teste')
    } finally {
      setLoading(false)
    }
  }

  const actualThreshold = result?.threshold ?? 40
  const actualBlocked = result ? result.score >= actualThreshold : false
  const effectivePreviewThreshold = previewThreshold ?? actualThreshold
  const previewBlocked = result ? result.score >= effectivePreviewThreshold : false

  // Item 161: agrupa os sinais por camada de detecção com o peso de cada um.
  const byLayer = (() => {
    if (!result?.signals?.length) return []
    const groups: Record<string, { raw: string; label: string; weight: number }[]> = {}
    for (const signal of result.signals) {
      const info = describeSignal(signal)
      ;(groups[info.layer] ??= []).push({ raw: signal, label: info.label, weight: info.weight })
    }
    return LAYER_ORDER.filter((layer) => groups[layer]?.length).map((layer) => ({ layer, items: groups[layer] }))
  })()

  // Item 163: veredito de infraestrutura a partir do ASN/org.
  const infra = (() => {
    if (!result) return null
    const org = (result.org || '').trim()
    const asn = result.asn || 0
    const isDc = result.signals?.some((signal) => signal.startsWith('asn:datacenter'))
    const isCarrier = result.signals?.some((signal) => signal.startsWith('asn:network'))
    const timedOut = result.signals?.includes('asn:deadline')
    if (timedOut) return { text: 'Consulta de rede expirou (resolve na próxima visita do mesmo IP)', kind: 'neutro' as const }
    if (isDc) return { text: `Data center / automação${org ? ` · ${org}` : ''}${asn ? ` (AS${asn})` : ''}`, kind: 'suspeito' as const }
    if (isCarrier) return { text: `Rede residencial / não-datacenter${org ? ` · ${org}` : ''}${asn ? ` (AS${asn})` : ''}`, kind: 'confiavel' as const }
    if (org || asn) return { text: `${org || 'rede'}${asn ? ` (AS${asn})` : ''}`, kind: 'neutro' as const }
    return null
  })()

  return (
    <section>
      <header className="mb-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-foreground">Validar configuração</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Teste a última configuração salva com este acesso ou com cenários sintéticos.
            </p>
          </div>
          <button
            type="button"
            onClick={() => runTest()}
            disabled={loading}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-secondary/35 px-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25 disabled:opacity-50"
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {loading ? 'Testando…' : profile ? 'Executar novamente' : 'Testar acesso atual'}
          </button>
        </div>
      </header>

      <div>
        <label htmlFor="ck-profile" className="text-sm font-medium text-foreground">Cenário de teste</label>
        <select
          id="ck-profile"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value)
            runTest(e.target.value)
          }}
          disabled={loading}
          className="mt-2 h-10 w-full rounded-lg border border-border bg-input px-3 text-sm text-foreground outline-none focus:border-brand-cyan/60 focus:ring-2 focus:ring-brand-cyan/15 disabled:opacity-50"
        >
          <option value="">Acesso atual desta dashboard</option>
          {profiles.map((item) => (
            <option key={item.id} value={item.id}>
              {(item.expected === 'bot' ? 'Seguro esperado — ' : 'Principal esperado — ') + item.label}
            </option>
          ))}
        </select>
        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          Trocar o cenário executa o teste automaticamente.
        </p>
        {profile && (
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {profiles.find((item) => item.id === profile)?.hint}
          </p>
        )}
      </div>

      {error && <p className="mt-4 text-sm leading-relaxed text-destructive">{error}</p>}

      {!result && !error && (
        <div className="py-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Teste o acesso atual ou escolha um cenário para verificar como a proteção classifica o tráfego.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">O teste usa a última configuração salva.</p>
        </div>
      )}

      {result && (
        <div className="mt-6 space-y-5">
          <section aria-labelledby="cloak-test-result">
            <p id="cloak-test-result" className="text-xs font-medium text-muted-foreground">Resultado</p>
            <div className="mt-1.5 flex items-center gap-2">
              <span
                className={`size-2 shrink-0 rounded-full ${actualBlocked ? 'bg-warning' : 'bg-success'}`}
                aria-hidden="true"
              />
              <p className="text-lg font-semibold text-foreground">
                {actualBlocked ? 'Destino seguro' : 'Destino principal'}
              </p>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Score de risco <span className="tabular-nums text-foreground">{result.score}</span> · limite{' '}
              <span className="tabular-nums text-foreground">{actualThreshold}</span>
            </p>
          </section>

          {result.profile && (() => {
            const gotBot = result.score >= actualThreshold
            const matched = (result.profile.expected === 'bot') === gotBot
            return (
              <p className={`text-sm leading-relaxed ${matched ? 'text-success' : 'text-warning'}`}>
                <span className="font-medium text-foreground">{result.profile.label}</span> ·{' '}
                {matched
                  ? 'Resultado esperado para este cenário.'
                  : 'Resultado diferente do esperado. Revise sensibilidade e regras antes de publicar.'}
              </p>
            )
          })()}

          {infra && (
            <p
              className={`text-sm leading-relaxed ${
                infra.kind === 'confiavel'
                  ? 'text-success'
                  : infra.kind === 'suspeito'
                    ? 'text-warning'
                    : 'text-muted-foreground'
              }`}
            >
              <span className="text-muted-foreground">Rede · </span>{infra.text}
            </p>
          )}

          <details className="group border-y border-border/60 py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25">
              <span>Simular outro limite</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="mt-4">
              <p className="text-xs leading-relaxed text-muted-foreground">Prévia local — não altera nem salva sua configuração.</p>
              <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>10</span>
                <span>Limite <strong className="tabular-nums text-foreground">{effectivePreviewThreshold}</strong></span>
                <span>90</span>
              </div>
              <input
                type="range"
                min={10}
                max={90}
                value={effectivePreviewThreshold}
                onChange={(e) => setPreviewThreshold(Number(e.target.value))}
                className="mt-2 w-full accent-[color:var(--brand-cyan)]"
                aria-label="Simular outro limite"
              />
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Com limite <span className="tabular-nums text-foreground">{effectivePreviewThreshold}</span>, este mesmo acesso iria para o{' '}
                <span className={previewBlocked ? 'text-warning' : 'text-success'}>
                  {previewBlocked ? 'destino seguro' : 'destino principal'}
                </span>.
              </p>
            </div>
          </details>

          <details className="group border-b border-border/60 pb-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-brand-cyan/25">
              <span>Detalhes técnicos</span>
              <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden="true" />
            </summary>

            <div className="mt-4 space-y-5">
              <dl className="space-y-2 text-xs">
                <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                  <dt className="text-muted-foreground">IP</dt>
                  <dd className="font-mono text-foreground">{result.ip || '—'}</dd>
                </div>
                <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                  <dt className="text-muted-foreground">UA</dt>
                  <dd className="break-all font-mono text-foreground">{result.ua || '—'}</dd>
                </div>
                {typeof result.resolvedAt === 'number' && (
                  <div className="grid grid-cols-[4rem_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">Tempo</dt>
                    <dd className="text-muted-foreground">
                      Julgado em {result.resolvedAt}ms
                      {result.signals?.includes('asn:deadline') && ' — consulta de rede estourou o tempo; a próxima visita do mesmo IP resolve pelo cache'}
                    </dd>
                  </div>
                )}
              </dl>

              {byLayer.length > 0 && (
                <section>
                  <h3 className="text-sm font-medium text-foreground">Sinais por camada</h3>
                  <div className="mt-3 divide-y divide-border/60 border-y border-border/60">
                    {byLayer.map(({ layer, items }) => (
                      <div key={layer} className="py-3.5">
                        <p className="text-sm font-medium text-foreground">{LAYER_META[layer].label}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">{LAYER_META[layer].hint}</p>
                        <ul className="mt-2 divide-y divide-border/40">
                          {items.map((item, index) => (
                            <li key={`${item.raw}-${index}`} title={item.raw} className="flex items-start justify-between gap-4 py-2 text-xs">
                              <span className="min-w-0 text-foreground">{item.label}</span>
                              <span
                                className={`shrink-0 font-mono tabular-nums ${
                                  item.weight > 0
                                    ? 'text-warning'
                                    : item.weight < 0
                                      ? 'text-success'
                                      : 'text-muted-foreground'
                                }`}
                              >
                                {item.weight > 0 ? `+${item.weight}` : item.weight}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  )
}
