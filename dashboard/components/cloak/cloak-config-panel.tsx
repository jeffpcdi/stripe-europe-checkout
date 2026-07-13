'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck, Play, Loader2, AlertTriangle } from 'lucide-react'
import { useCloakConfig, useHealth, apiSend } from '@/lib/api'
import type { CloakConfig, CloakSensitivity, CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Switch } from '@/components/ui/switch'

// Camadas de detecção expostas na UI — rótulo + descrição curta.
const LAYERS: { key: keyof CloakConfig; label: string; hint: string }[] = [
  { key: 'blockDatacenter', label: 'Bloquear datacenter', hint: 'ASN de nuvem / ByteDance' },
  { key: 'blockHeadless', label: 'Bloquear headless', hint: 'navegador automatizado + Client Hints' },
  { key: 'checkHeaders', label: 'Headers obrigatórios', hint: 'Sec-Fetch e cabeçalhos de browser real' },
  { key: 'requireJsChallenge', label: 'Challenge JS', hint: 'token HMAC executado no cliente' },
  { key: 'checkWebgl', label: 'WebGL renderer', hint: 'detecta SwiftShader / GPU emulada' },
  { key: 'checkTimezone', label: 'Timezone vs IP', hint: 'fuso IANA coerente com a geo' },
  { key: 'checkBehavior', label: 'Biometria', hint: 'padrão de mouse/scroll humano' },
  { key: 'blockZhLang', label: 'Bloquear zh fora da CN', hint: 'accept-language chinês suspeito' },
  { key: 'checkWebview', label: 'Integridade webview', hint: 'UA in-app vs globals do JS' },
  { key: 'checkCoherence', label: 'Coerência de device', hint: 'plataforma/hardware x UA/geo' },
  { key: 'checkEntropy', label: 'Entropia de ação', hint: 'movimento e ação sem trilha' },
]

const SENSITIVITY: { id: CloakSensitivity; label: string; hint: string; tradeoff: string }[] = [
  { id: 'strict', label: 'Rígido', hint: 'bloqueia mais (threshold 30)', tradeoff: 'Barra quase todo revisor, mas pode desviar alguns compradores reais.' },
  { id: 'balanced', label: 'Equilibrado', hint: 'padrão (threshold 40)', tradeoff: 'Equilíbrio recomendado entre proteger a conta e não perder venda.' },
  { id: 'loose', label: 'Leve', hint: 'bloqueia menos (threshold 55)', tradeoff: 'Deixa passar quase todo comprador, mas arrisca deixar um revisor ver a offer.' },
  { id: 'custom', label: 'Custom', hint: 'threshold manual', tradeoff: 'Você define o limiar exato (10–90).' },
]

// Item 168: camadas D–H só têm efeito quando o Challenge JS está ligado — elas
// dependem do challengeData coletado pelo snippet /t.js.
const CHALLENGE_DEPENDENT: { key: keyof CloakConfig; label: string }[] = [
  { key: 'checkWebgl', label: 'WebGL renderer' },
  { key: 'checkTimezone', label: 'Timezone vs IP' },
  { key: 'checkBehavior', label: 'Biometria' },
  { key: 'checkEntropy', label: 'Entropia de ação' },
]

function Toggle({
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-secondary/40 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm text-foreground">{label}</span>
        <span className="block text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <Switch checked={checked} onChange={onChange} label={label} />
    </label>
  )
}

export function CloakConfigPanel() {
  const { data, mutate } = useCloakConfig()
  const { data: health } = useHealth() // item 255: velocity distribuído exige Redis
  const [draft, setDraft] = useState<CloakConfig | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<CloakTestResult | null>(null)

  // Hidrata o rascunho quando os dados chegam (uma vez por payload novo)
  useEffect(() => {
    if (data && !draft) setDraft(data)
  }, [data, draft])

  const cfg = draft ?? data
  if (!cfg) {
    return <GlassCard className="h-64 animate-pulse p-5" />
  }

  function patch(p: Partial<CloakConfig>) {
    setDraft((d) => ({ ...(d ?? (data as CloakConfig)), ...p }))
  }

  async function handleSave() {
    if (!draft) return
    setSaving(true)
    try {
      await apiSend('/api/cloak-config', 'POST', draft)
      setSavedAt(Date.now())
      mutate()
      setTimeout(() => setSavedAt(null), 2000)
    } finally {
      setSaving(false)
    }
  }

  async function handleTest() {
    setTesting(true)
    setTest(null)
    try {
      const r = await apiSend<CloakTestResult>('/api/cloak/test', 'POST')
      setTest(r)
    } finally {
      setTesting(false)
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span
            className="flex size-8 items-center justify-center rounded-[10px] text-[color:var(--brand-cyan)]"
            style={{ background: 'color-mix(in oklab, var(--brand-cyan) 14%, transparent)' }}
            aria-hidden="true"
          >
            <ShieldCheck className="size-4" />
          </span>
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Filtro de bots (global)</h2>
            <p className="text-xs text-muted-foreground">Regras padrão aplicadas a todos os links protegidos</p>
          </div>
        </div>
        <StatusBadge status={cfg.enabled ? 'success' : 'neutral'}>
          {cfg.enabled ? 'ativo' : 'desligado'}
        </StatusBadge>
      </div>

      {/* Item 76 + A8.1: interruptor mestre em destaque — o painel do switch
          muda a cor de fundo conforme o estado (proteção ativa/inativa) */}
      <div className="mb-4">
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors duration-240 ${
            cfg.enabled
              ? 'border-[color:var(--pink)]/30 bg-[color:var(--pink)]/8'
              : 'border-[color:var(--warning)]/30 bg-[color:var(--warning)]/8'
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {cfg.enabled ? 'Proteção ativa' : 'Proteção inativa'}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              interruptor mestre — desliga toda a proteção
            </span>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={cfg.enabled}
            aria-label="Cloaking ativado"
            onClick={() => patch({ enabled: !cfg.enabled })}
            className={cfg.enabled ? 'cloak-switch cloak-switch--on' : 'cloak-switch cloak-switch--off'}
          >
            <span className="cloak-switch__knob" />
          </button>
        </div>
        {cfg.enabled ? (
          <div className="cloak-banner anim-pop-in mt-2 flex items-center gap-2 rounded-lg px-3 py-2">
            <ShieldCheck className="size-3.5 text-[color:var(--pink)]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[color:var(--pink)]">
              Cloaker ativo — tráfego suspeito será desviado
            </span>
          </div>
        ) : (
          /* A8.1: estado inativo com aviso claro — todo mundo vê a offer */
          <div className="anim-pop-in mt-2 flex items-center gap-2 rounded-lg bg-[color:var(--warning)]/10 px-3 py-2">
            <AlertTriangle className="size-3.5 text-[color:var(--warning)]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[color:var(--warning)]">
              Proteção desligada — todos os acessos (inclusive revisores) veem a oferta real
            </span>
          </div>
        )}
      </div>

      {/* Sensibilidade */}
      <div className="mb-4">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Sensibilidade</span>
        {/* Item 139: explica o que o threshold significa e o mapa sensibilidade→número */}
        <p className="mb-2 text-[11px] leading-relaxed text-muted-foreground text-pretty">
          Cada acesso recebe um <strong className="text-foreground">score</strong> de suspeita (0–100). Quando o score
          atinge o <strong className="text-foreground">threshold</strong>, o visitante vai para a página branca.
          Threshold mais baixo = protege mais, mas arrisca desviar alguns usuários reais.
          {cfg.sensitivityThresholds && (
            <>
              {' '}
              Efetivo:{' '}
              {Object.entries(cfg.sensitivityThresholds)
                .map(([k, v]) => `${SENSITIVITY.find((s) => s.id === k)?.label ?? k} ≥${v}`)
                .join(' · ')}
              .
            </>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {SENSITIVITY.map((s) => {
            const active = (cfg.sensitivity ?? 'balanced') === s.id
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => patch({ sensitivity: s.id })}
                className={`rounded-lg border px-2 py-2 text-center transition-colors ${
                  active
                    ? 'border-[color:var(--brand-cyan)] bg-[var(--accent-light)]'
                    : 'border-border bg-secondary/40 hover:bg-secondary'
                }`}
              >
                <span className={`block text-sm font-medium ${active ? 'text-brand-cyan' : 'text-foreground'}`}>
                  {s.label}
                </span>
                <span className="block text-[10px] text-muted-foreground">{s.hint}</span>
              </button>
            )
          })}
        </div>
        {/* Item 167: trade-off do preset selecionado, em linguagem de negócio */}
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          {(SENSITIVITY.find((s) => s.id === (cfg.sensitivity ?? 'balanced')) ?? SENSITIVITY[1]).tradeoff}
        </p>
        {cfg.sensitivity === 'custom' && (
          <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            Threshold manual
            <input
              type="number"
              min={10}
              max={90}
              value={cfg.threshold}
              onChange={(e) => patch({ threshold: Number(e.target.value) })}
              className="w-20 rounded-lg border border-border bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            />
            <span>score ≥ threshold ⇒ bot</span>
          </label>
        )}
      </div>

      {/* White page global */}
      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">White page de fallback (vazio = página neutra embutida)</span>
        <input
          value={cfg.defaultWhitePage ?? ''}
          onChange={(e) => patch({ defaultWhitePage: e.target.value })}
          placeholder="https://blog-inocente.com"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {/* Item 172: white page de fallback preenchida mas inválida (não https)
            manda o revisor a uma página de erro e queima a conta — avisar */}
        {(cfg.defaultWhitePage ?? '').trim() !== '' && !/^https:\/\//.test((cfg.defaultWhitePage ?? '').trim()) && (
          <span className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A white page de fallback precisa começar com <code>https://</code>. Uma página quebrada leva o revisor a
              um erro e pode queimar a conta — corrija ou deixe vazio para usar a página neutra embutida.
            </span>
          </span>
        )}
      </label>

      {/* Itens 254/260: camada de velocity (anti device-farm). Configurável
          por conta com clamp seguro no servidor (3–100 acessos, 10–600s). */}
      <div className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Limite de acessos por IP (anti device-farm)</span>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span>máximo de</span>
          <input
            type="number"
            min={3}
            max={100}
            value={cfg.velocityLimit ?? 12}
            onChange={(e) => patch({ velocityLimit: Number(e.target.value) })}
            className="w-16 rounded-lg border border-border bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Máximo de acessos do mesmo IP na janela"
          />
          <span>acessos do mesmo IP a cada</span>
          <input
            type="number"
            min={10}
            max={600}
            value={cfg.velocityWindowSec ?? 60}
            onChange={(e) => patch({ velocityWindowSec: Number(e.target.value) })}
            className="w-16 rounded-lg border border-border bg-input px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Janela de contagem em segundos"
          />
          <span>segundos</span>
        </div>
        <span className="text-[11px] leading-relaxed text-muted-foreground text-pretty">
          Uma &quot;device farm&quot; martela o link várias vezes por minuto a partir do mesmo IP; visitantes acima
          do limite vão para a página branca. O padrão (12 a cada 60s) tem folga para família no mesmo Wi-Fi.
        </span>
        {/* Item 255: sem Redis a contagem é só por instância (memória local) —
            uma farm distribuída entre vários IPs/instâncias passa despercebida. */}
        {health && !health.redis && (
          <span className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              Sem Redis, a contagem de acessos é feita apenas nesta instância do servidor. Uma device-farm
              distribuída entre várias máquinas só é barrada de forma confiável com o Redis ativo.
            </span>
          </span>
        )}
      </div>

      {/* Camadas de detecção */}
      <span className="mb-2 block text-xs font-medium text-muted-foreground">Camadas de detecção</span>
      <div className="grid gap-2 sm:grid-cols-2">
        {LAYERS.map((l) => (
          <Toggle
            key={l.key}
            checked={cfg[l.key] as boolean}
            onChange={(v) => patch({ [l.key]: v } as Partial<CloakConfig>)}
            label={l.label}
            hint={l.hint}
          />
        ))}
      </div>

      {/* Item 173: blockZhLang barra qualquer accept-language chinês — inclui
          chinês real fora da CN (diáspora, turistas). Nota de contexto */}
      {(cfg.blockZhLang as boolean) && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" aria-hidden="true" />
          <span>
            <strong className="text-foreground">Bloquear zh fora da CN</strong> desvia todo visitante com idioma chinês
            fora da China para a página branca. Isso barra revisores da ByteDance, mas também pode atingir{' '}
            <strong className="text-foreground">público chinês legítimo</strong> (diáspora, turistas). Deixe ligado só
            se sua campanha não mira falantes de chinês reais.
          </span>
        </div>
      )}

      {/* Item 168: camadas D–H inertes sem o Challenge JS */}
      {!cfg.requireJsChallenge &&
        (() => {
          const inertes = CHALLENGE_DEPENDENT.filter((l) => cfg[l.key] as boolean)
          if (!inertes.length) return null
          return (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-[11px] leading-relaxed text-warning">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                <strong>{inertes.map((l) => l.label).join(', ')}</strong>{' '}
                {inertes.length > 1 ? 'dependem' : 'depende'} do <strong>Challenge JS</strong>, que está desligado.
                Sem ele o snippet não coleta os dados do navegador e{' '}
                {inertes.length > 1 ? 'essas camadas ficam sem efeito' : 'essa camada fica sem efeito'}. Ligue o
                Challenge JS ou desative {inertes.length > 1 ? 'essas camadas' : 'essa camada'} para evitar configuração inócua.
              </span>
            </div>
          )
        })()}

      {/* Teste ao vivo do request atual */}
      {test && (
        <div className="mt-4 rounded-lg border border-border bg-secondary/40 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Seu request agora:</span>
            <StatusBadge status={test.verdict === 'real' ? 'success' : test.verdict === 'erro' ? 'error' : 'warning'}>
              {test.verdict} · score {test.score}/{test.threshold}
            </StatusBadge>
          </div>
          {test.signals.length > 0 && (
            <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">{test.signals.join(' · ')}</p>
          )}
          {/* Item 257: previsão da camada anti device-farm — em quantos acessos
              do mesmo IP na janela este visitante seria mandado à white */}
          {test.velocity && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground text-pretty">
              {test.velocity.note}
            </p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
          Testar meu acesso
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? 'Salvando…' : savedAt ? 'Salvo ✓' : 'Salvar configuração'}
        </button>
      </div>
    </GlassCard>
  )
}
