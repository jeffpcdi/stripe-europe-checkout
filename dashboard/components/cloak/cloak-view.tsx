'use client'

import { useState } from 'react'
import { FlaskConical, Loader2, Server, Timer, SlidersHorizontal, Bot, Check, X } from 'lucide-react'
import { apiSend, useCloakTestProfiles } from '@/lib/api'
import type { CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { CloakConfigPanel } from './cloak-config-panel'
import { CloakStatsPanel } from './cloak-stats-panel'
import { CloakEntriesPanel } from './cloak-entries-panel'
import { describeSignal, LAYER_META, type SignalLayer } from './signal-labels'

const CLOAK_STEPS: TutorialStep[] = [
  {
    title: 'O que o cloaker faz',
    body: (
      <>
        Ele decide, a cada acesso, quem vê a <strong>página segura</strong> (white page) e quem vê a{' '}
        <strong>oferta real</strong>. Robôs de revisão, bots e acessos suspeitos ficam na página segura;
        o comprador real passa para a oferta.
      </>
    ),
    tip: 'Isso protege a conta de anúncios de reprovações por revisar a oferta diretamente.',
  },
  {
    title: 'Como pontua o acesso',
    body: (
      <>
        Cada acesso ganha um <strong>score</strong> a partir de sinais (data center, robôs conhecidos,
        país fora do alvo, comportamento de automação…). Se o score passa do <strong>limiar</strong>, o
        acesso é bloqueado e vê a white page.
      </>
    ),
  },
  {
    title: 'Configuração e entradas',
    body: (
      <>
        No painel de <strong>configuração</strong> você ajusta o limiar e as regras. Em{' '}
        <strong>entradas</strong>, define páginas branca/oferta e segmentação por país. Comece com o
        preset padrão — ele já é seguro.
      </>
    ),
  },
  {
    title: 'Teste antes de subir',
    body: (
      <>
        Use o <strong>Teste ao vivo</strong> para ver como o cloaker classificaria o seu próprio acesso,
        com o score e os sinais detectados. Em <strong>Simular visitante</strong> você ainda roda perfis
        prontos — revisor da ByteDance, navegador headless, usuário real do anúncio — e confere se cada
        um cai no lado certo. Tudo sem gastar clique de anúncio.
      </>
    ),
  },
]

export function CloakView() {
  const [showTutorial, setShowTutorial] = useState(false)
  return (
    /* Item 58: gap-5 na raiz — mesmo ritmo vertical nas 5 abas da Gestão.
       flex-wrap no cabeçalho segue o padrão das outras abas no mobile. */
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground text-pretty">
          Proteja sua oferta: robôs veem a página segura, compradores veem a oferta real.
        </p>
        <TutorialButton onClick={() => setShowTutorial(true)} />
      </div>

      <div data-tour="cloak-stats">
        <CloakStatsPanel />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div data-tour="cloak-config">
          <CloakConfigPanel />
        </div>
        <div data-tour="cloak-test">
          <CloakTestPanel />
        </div>
      </div>

      <CloakEntriesPanel />

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como funciona o cloaker"
        steps={CLOAK_STEPS}
      />
    </div>
  )
}

const LAYER_ORDER: SignalLayer[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']

function CloakTestPanel() {
  const [result, setResult] = useState<CloakTestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Item 166: preview de threshold — recalcula o veredito localmente sem novo request
  const [previewThreshold, setPreviewThreshold] = useState<number | null>(null)
  // Item 165/208: perfil de visitante simulado ('' = meu acesso real)
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

  const effectiveThreshold = previewThreshold ?? result?.threshold ?? 40
  const isBlocked = result ? result.score >= effectiveThreshold : false

  // Item 161: agrupa os sinais por camada de detecção com o peso de cada um
  const byLayer = (() => {
    if (!result?.signals?.length) return []
    const groups: Record<string, { raw: string; label: string; kind: string; weight: number }[]> = {}
    for (const s of result.signals) {
      const info = describeSignal(s)
      ;(groups[info.layer] ??= []).push({ raw: s, label: info.label, kind: info.kind, weight: info.weight })
    }
    return LAYER_ORDER.filter((l) => groups[l]?.length).map((l) => ({ layer: l, items: groups[l] }))
  })()

  // Item 163: veredito de infraestrutura a partir do ASN/org
  const infra = (() => {
    if (!result) return null
    const org = (result.org || '').trim()
    const asn = result.asn || 0
    const isDc = result.signals?.some((s) => s.startsWith('asn:datacenter') || s === 'ip:bytedance-cidr')
    const isCarrier = result.signals?.some((s) => s.startsWith('asn:carrier'))
    const timedOut = result.signals?.includes('asn:deadline')
    if (timedOut) return { text: 'Consulta de rede expirou (resolve na próxima visita do mesmo IP)', kind: 'neutro' as const }
    if (isDc) return { text: `Data center / revisor${org ? ` · ${org}` : ''}${asn ? ` (AS${asn})` : ''}`, kind: 'suspeito' as const }
    if (isCarrier) return { text: `Operadora / provedor real${org ? ` · ${org}` : ''}${asn ? ` (AS${asn})` : ''}`, kind: 'confiavel' as const }
    if (org || asn) return { text: `${org || 'rede'}${asn ? ` (AS${asn})` : ''}`, kind: 'neutro' as const }
    return null
  })()

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Teste ao vivo</h2>
          <p className="text-xs text-muted-foreground">
            {profile ? 'Simula um visitante escolhido' : 'Julga a requisição atual deste navegador'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => runTest()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
        >
          {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FlaskConical className="size-3.5" />}
          Rodar teste
        </button>
      </div>

      {/* Item 165/208: simulador de perfis — julga visitantes sintéticos
          (revisor ByteDance, headless, usuário do anúncio…) com o MESMO motor */}
      <div className="mb-4">
        <label htmlFor="ck-profile" className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Bot className="size-3.5" /> Simular visitante
        </label>
        <select
          id="ck-profile"
          value={profile}
          onChange={(e) => {
            setProfile(e.target.value)
            runTest(e.target.value)
          }}
          disabled={loading}
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          <option value="">Meu acesso real (este navegador)</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {(p.expected === 'bot' ? '[bloqueia] ' : '[libera] ') + p.label}
            </option>
          ))}
        </select>
        {profile && (
          <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {profiles.find((p) => p.id === profile)?.hint}
          </p>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!result && !error && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Rode o teste para ver como o cloaker classificaria seu acesso.
        </p>
      )}

      {result && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between rounded-xl border border-border bg-secondary/40 p-4">
            <div>
              <p className="label-mono">Veredito</p>
              <p className="text-lg font-semibold text-foreground">
                {isBlocked ? 'Página branca' : 'Offer liberada'}
              </p>
            </div>
            <StatusBadge status={isBlocked ? 'error' : 'success'}>
              score {result.score} / {effectiveThreshold}
            </StatusBadge>
          </div>

          {/* Item 165/208: quando é um perfil simulado, confronta o veredito real
              do motor com o esperado — verde se bateu, âmbar se divergiu */}
          {result.profile && (() => {
            const gotBot = result.score >= (result.threshold ?? 40)
            const matched = (result.profile.expected === 'bot') === gotBot
            return (
              <div
                className={`flex items-start gap-2 rounded-lg border p-3 text-xs ${
                  matched
                    ? 'border-success/30 bg-success/10 text-success'
                    : 'border-warning/40 bg-warning/10 text-warning'
                }`}
              >
                {matched ? <Check className="mt-0.5 size-3.5 shrink-0" /> : <X className="mt-0.5 size-3.5 shrink-0" />}
                <span className="text-pretty">
                  <strong className="text-foreground">{result.profile.label}</strong> —{' '}
                  {result.profile.expected === 'bot' ? 'deveria ir para a white page' : 'deveria passar para a offer'}.{' '}
                  {matched
                    ? 'O motor classificou como esperado.'
                    : 'O motor divergiu do esperado — revise threshold e regras antes de subir a campanha.'}
                </span>
              </div>
            )
          })()}

          {/* Item 166: slider de threshold com preview ao vivo do mesmo score */}
          <div className="rounded-lg border border-border bg-secondary/40 p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <SlidersHorizontal className="size-3.5" />
              Simular threshold: <span className="text-foreground">≥{effectiveThreshold}</span>
            </div>
            <input
              type="range"
              min={10}
              max={90}
              value={effectiveThreshold}
              onChange={(e) => setPreviewThreshold(Number(e.target.value))}
              className="w-full accent-[color:var(--brand-cyan)]"
              aria-label="Simular threshold"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Com score <strong className="text-foreground">{result.score}</strong>, este acesso{' '}
              {isBlocked ? (
                <span className="text-destructive">iria para a página branca</span>
              ) : (
                <span className="text-success">passaria para a offer</span>
              )}
              . Arraste para ver como cada limiar afeta o mesmo acesso — sem novo teste.
            </p>
          </div>

          {/* Item 163: infraestrutura resolvida (ASN/operadora) */}
          {infra && (
            <div className="flex items-start gap-2 text-xs">
              <Server className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              <span
                className={
                  infra.kind === 'confiavel'
                    ? 'text-success'
                    : infra.kind === 'suspeito'
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                }
              >
                {infra.text}
              </span>
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 text-xs">
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-muted-foreground">IP</span>
              <span className="font-mono text-foreground">{result.ip || '—'}</span>
            </div>
            <div className="flex items-start gap-2">
              <span className="w-10 shrink-0 text-muted-foreground">UA</span>
              <span className="break-all font-mono text-foreground">{result.ua || '—'}</span>
            </div>
            {/* Itens 164/210: tempo de julgamento (DNS/ASN lento fica visível) */}
            {typeof result.resolvedAt === 'number' && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Timer className="size-3.5 shrink-0" />
                <span>
                  Julgado em {result.resolvedAt}ms
                  {result.signals?.includes('asn:deadline') && ' — consulta de rede estourou o tempo; a próxima visita do mesmo IP resolve pelo cache'}
                </span>
              </div>
            )}
          </div>

          {/* Item 161: sinais agrupados por camada de detecção, com peso */}
          {byLayer.length > 0 && (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs font-medium text-muted-foreground">Sinais por camada</p>
              {byLayer.map(({ layer, items }) => (
                <div key={layer} className="rounded-lg border border-border bg-secondary/30 p-2.5">
                  <p className="mb-1.5 text-[11px] font-semibold text-foreground">
                    {LAYER_META[layer].label}
                    <span className="ml-1 font-normal text-muted-foreground">· {LAYER_META[layer].hint}</span>
                  </p>
                  <ul className="flex flex-wrap gap-1.5">
                    {items.map((it, i) => {
                      const cls =
                        it.kind === 'confiavel'
                          ? 'bg-[var(--success-light)] text-success'
                          : it.kind === 'suspeito'
                            ? 'bg-destructive/15 text-destructive'
                            : 'bg-secondary text-muted-foreground'
                      return (
                        <li key={i}>
                          <span title={it.raw} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] ${cls}`}>
                            {it.label}
                            {it.weight !== 0 && (
                              <span className="font-mono opacity-70">
                                {it.weight > 0 ? `+${it.weight}` : it.weight}
                              </span>
                            )}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
