'use client'

import { useState, useEffect } from 'react'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { ApiError, useCloakConfig, useHealth, apiSend } from '@/lib/api'
import type { CloakConfig, CloakSensitivity } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { StatusBadge } from '@/components/status-badge'
import { Switch } from '@/components/ui/switch'
import { SectionTitle } from '@/components/section-title'
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
  { id: 'strict', label: 'Rígido', hint: 'bloqueia mais (threshold 30)', tradeoff: 'Bloqueia mais tráfego suspeito, mas pode desviar alguns usuários legítimos.' },
  { id: 'balanced', label: 'Equilibrado', hint: 'padrão (threshold 40)', tradeoff: 'Equilíbrio recomendado entre proteger a conta e não perder venda.' },
  { id: 'loose', label: 'Leve', hint: 'bloqueia menos (threshold 55)', tradeoff: 'Reduz falsos positivos, mas permite mais tráfego automatizado ou suspeito.' },
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
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5 transition-colors hover:bg-secondary/35">
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
    return <GlassCard className="h-64 animate-pulse p-5" />
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
            <SectionTitle>Proteção global</SectionTitle>
            <p className="text-xs text-muted-foreground">Defina o comportamento padrão dos links protegidos</p>
          </div>
        </div>
        <StatusBadge status={cfg.enabled ? 'success' : 'neutral'}>
          {cfg.enabled ? (cfg.shadowMode ? 'observando' : 'ativo') : 'desligado'}
        </StatusBadge>
      </div>

      {/* Item 76 + A8.1: interruptor mestre em destaque — o painel do switch
          muda a cor de fundo conforme o estado (proteção ativa/inativa) */}
      <div className="mb-4">
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors duration-240 ${
            cfg.enabled
              ? 'border-success/25 bg-success/8'
              : 'border-warning/25 bg-warning/8'
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">
              {cfg.enabled ? (cfg.shadowMode ? 'Modo observação' : 'Proteção ativa') : 'Proteção inativa'}
            </span>
            <span className="block text-[11px] text-muted-foreground">
              interruptor mestre — desliga toda a proteção
            </span>
          </span>
          <Switch
            checked={cfg.enabled}
            onChange={(v) => patch({ enabled: v })}
            label="Cloaking ativado"
          />
        </div>
        {cfg.enabled ? (
          <div className="anim-pop-in mt-2 flex items-center gap-2 rounded-xl border border-success/20 bg-success/10 px-3 py-2">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            <span className="text-[11px] font-medium text-success">{cfg.shadowMode ? 'Modo observação — classifica sem alterar o destino.' : 'Proteção ativa — acessos suspeitos seguem para a página segura.'}</span>
          </div>
        ) : (
          /* A8.1: estado inativo com aviso claro — todo mundo vê a offer */
          <div className="anim-pop-in mt-2 flex items-center gap-2 rounded-lg bg-[color:var(--warning)]/10 px-3 py-2">
            <AlertTriangle className="size-3.5 text-[color:var(--warning)]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[color:var(--warning)]">
              Proteção desligada — todos os acessos seguem para o destino principal
            </span>
          </div>
        )}
      </div>

      <div className="mb-4">
        <Toggle
          checked={cfg.shadowMode === true}
          onChange={(v) => patch({ shadowMode: v })}
          label="Modo observação"
          hint="Classifica acessos sem alterar o destino"
        />
      </div>

      {/* Sensibilidade */}
      <div className="mb-4">
        <span className="mb-1 block text-xs font-medium text-muted-foreground">Sensibilidade</span>
        {/* Explicação completa no tooltip — menos texto na tela */}
        <p
          className="mb-2 text-[11px] text-muted-foreground"
          title="Cada acesso recebe um score de suspeita (0–100). Quando o score atinge o threshold, o visitante vai para a página branca. Threshold mais baixo = protege mais, mas arrisca desviar alguns usuários reais."
        >
          Mais sensível = protege mais, mas pode desviar usuários reais.
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
            <span>score ≥ threshold ⇒ suspeito</span>
          </label>
        )}
      </div>

      {/* White page global */}
      <label className="mb-4 flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Página segura de fallback (vazio = página neutra embutida)</span>
        <input
          value={cfg.defaultWhitePage ?? ''}
          onChange={(e) => patch({ defaultWhitePage: e.target.value })}
          placeholder="https://pagina-segura.com"
          className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        {/* Destino seguro inválido interrompe o fluxo; avisar antes de salvar. */}
        {(cfg.defaultWhitePage ?? '').trim() !== '' && !/^https:\/\//.test((cfg.defaultWhitePage ?? '').trim()) && (
          <span className="flex items-start gap-1.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-warning">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>
              A página segura de fallback precisa começar com <code>https://</code>. Uma página quebrada leva o visitante a
              um erro e interrompe o fluxo — corrija ou deixe vazio para usar a página neutra embutida.
            </span>
          </span>
        )}
      </label>

      <details className="mb-4 rounded-2xl border border-border/60 bg-secondary/10 p-4">
        <summary className="cursor-pointer list-none">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Configurações avançadas</p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">Limites por IP, automação e camadas técnicas de detecção.</p>
            </div>
            <span className="rounded-full border border-border/60 bg-secondary/20 px-2 py-0.5 text-[10px] text-muted-foreground">Opcional</span>
          </div>
        </summary>
        <div className="mt-4">

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
        <span
          className="text-[11px] text-muted-foreground"
          title="Automação pode repetir acessos rapidamente a partir do mesmo IP; visitantes acima do limite seguem a política de proteção. O padrão (12 a cada 60s) mantém folga para redes compartilhadas."
        >
          Acima do limite, a política de proteção é aplicada.
        </span>
        {health && !health.redis && (
          <span
            className="text-[11px] text-warning"
            title="Sem Redis, a contagem de acessos é feita apenas nesta instância do servidor. Uma device-farm distribuída entre várias máquinas só é barrada de forma confiável com o Redis ativo."
          >
            Sem Redis, a contagem vale só para esta instância.
          </span>
        )}
      </div>

      <div className="mb-4 rounded-xl border border-border bg-secondary/25 p-3">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span>
            <span className="block text-xs font-medium text-foreground">Bloqueio automático por anúncio</span>
            <span className="block text-[11px] text-muted-foreground">Agrupa riscos altos por IP e anúncio sem armazenar o IP bruto.</span>
          </span>
          <Switch checked={cfg.autoBlockEnabled === true} onChange={(value) => patch({ autoBlockEnabled: value })} label="Bloqueio automático" />
        </div>
        {cfg.autoBlockEnabled === true && (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="text-[10px] text-muted-foreground">Sinais para bloquear<input type="number" min={3} max={100} value={cfg.autoBlockThreshold ?? 8} onChange={(event) => patch({ autoBlockThreshold: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground" /></label>
            <label className="text-[10px] text-muted-foreground">Janela (min)<input type="number" min={5} max={1440} value={cfg.autoBlockWindowMin ?? 30} onChange={(event) => patch({ autoBlockWindowMin: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground" /></label>
            <label className="text-[10px] text-muted-foreground">Bloqueio (horas)<input type="number" min={1} max={720} value={cfg.autoBlockTtlHours ?? 24} onChange={(event) => patch({ autoBlockTtlHours: Number(event.target.value) })} className="mt-1 w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs text-foreground" /></label>
          </div>
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

      {!cfg.requireJsChallenge &&
        (() => {
          const inertes = CHALLENGE_DEPENDENT.filter((l) => cfg[l.key] as boolean)
          if (!inertes.length) return null
          return (
            <p
              className="mt-3 flex items-center gap-1.5 text-[11px] text-warning"
              title={`${inertes.map((l) => l.label).join(', ')} ${inertes.length > 1 ? 'dependem' : 'depende'} do Challenge JS, que está desligado — sem ele ${inertes.length > 1 ? 'essas camadas ficam' : 'essa camada fica'} sem efeito. Ligue o Challenge JS ou desative para evitar configuração inócua.`}
            >
              <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
              {inertes.length} camada(s) sem efeito com o Challenge JS desligado.
            </p>
          )
        })()}

        </div>
      </details>

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
        {remoteChanged && (
          <>
            <span className="mr-auto text-[11px] text-warning">Há uma versão mais nova.</span>
            <button type="button" onClick={() => void reloadRemote()} className="btn-secondary px-3 py-2 text-xs">Recarregar</button>
          </>
        )}
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !dirty || remoteChanged}
          className="btn-primary px-4 py-2 text-sm"
        >
          {saving ? 'Salvando…' : savedAt ? 'Salvo ✓' : 'Salvar'}
        </button>
      </div>
    </GlassCard>
  )
}
