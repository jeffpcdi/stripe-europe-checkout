'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck, Play, Loader2 } from 'lucide-react'
import { useCloakConfig, apiSend } from '@/lib/api'
import type { CloakConfig, CloakSensitivity, CloakTestResult } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'

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

const SENSITIVITY: { id: CloakSensitivity; label: string; hint: string }[] = [
  { id: 'strict', label: 'Rígido', hint: 'bloqueia mais (threshold 30)' },
  { id: 'balanced', label: 'Equilibrado', hint: 'padrão (threshold 40)' },
  { id: 'loose', label: 'Leve', hint: 'bloqueia menos (threshold 55)' },
  { id: 'custom', label: 'Custom', hint: 'threshold manual' },
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
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-[color:var(--brand-cyan)]' : 'bg-muted'
        }`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${
            checked ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  )
}

export function CloakConfigPanel() {
  const { data, mutate } = useCloakConfig()
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
            <h2 className="text-sm font-semibold text-foreground">Filtro de bots (global)</h2>
            <p className="text-xs text-muted-foreground">Regras padrão aplicadas a todos os links protegidos</p>
          </div>
        </div>
        <StatusBadge status={cfg.enabled ? 'success' : 'neutral'}>
          {cfg.enabled ? 'ativo' : 'desligado'}
        </StatusBadge>
      </div>

      {/* Interruptor mestre */}
      <div className="mb-4">
        <Toggle
          checked={cfg.enabled}
          onChange={(v) => patch({ enabled: v })}
          label="Cloaking ativado"
          hint="interruptor mestre — desliga toda a proteção"
        />
      </div>

      {/* Sensibilidade */}
      <div className="mb-4">
        <span className="mb-2 block text-xs font-medium text-muted-foreground">Sensibilidade</span>
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
      </label>

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
