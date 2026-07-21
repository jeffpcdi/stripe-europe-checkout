'use client'

import { useEffect, useState } from 'react'
import { Bot, CircleDollarSign, Loader2, Send, ShieldAlert, Smartphone } from 'lucide-react'
import useSWR from 'swr'
import { apiSend, fetcher } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Switch } from '@/components/ui/switch'
import {
  checkSupport,
  subscribeDevice,
  unsubscribeDevice,
  isThisDeviceSubscribed,
  type WebPushSupport,
} from '@/lib/web-push'

type PreferenceGroup = 'sales' | 'risks' | 'automation'
type Status = {
  ok: boolean
  devices: number
  funMode: boolean
  preferences: Record<PreferenceGroup, boolean>
}

const PREFERENCES: {
  key: PreferenceGroup
  label: string
  hint: string
  icon: typeof CircleDollarSign
}[] = [
  {
    key: 'sales',
    label: 'Vendas',
    hint: 'Pagamentos confirmados',
    icon: CircleDollarSign,
  },
  {
    key: 'risks',
    label: 'Riscos e segurança',
    hint: 'Recusas, reembolsos, disputas e acessos',
    icon: ShieldAlert,
  },
  {
    key: 'automation',
    label: 'Automações do TikTok Ads',
    hint: 'Somente propostas, bloqueios, reprovações e falhas',
    icon: Bot,
  },
]

export function WebPushCard() {
  const { data, mutate } = useSWR<Status>('/api/webpush/status', fetcher, {
    revalidateOnFocus: false,
  })
  const [support, setSupport] = useState<WebPushSupport | null>(null)
  const [thisDevice, setThisDevice] = useState(false)
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    setSupport(checkSupport())
    isThisDeviceSubscribed().then(setThisDevice).catch(() => setThisDevice(false))
  }, [])

  async function handleToggleDevice() {
    setMsg(null)
    setBusy(true)
    try {
      if (thisDevice) {
        await unsubscribeDevice()
        setThisDevice(false)
        setMsg({ ok: true, text: 'Notificações desativadas neste aparelho.' })
      } else {
        await subscribeDevice()
        setThisDevice(true)
        setMsg({ ok: true, text: 'Este aparelho está pronto para receber alertas.' })
      }
      await mutate()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Não foi possível ativar' })
    } finally {
      setBusy(false)
    }
  }

  async function handlePreference(group: PreferenceGroup, enabled: boolean) {
    mutate((current) => current
      ? { ...current, preferences: { ...current.preferences, [group]: enabled } }
      : current, false)
    try {
      await apiSend('/api/webpush/preferences', 'POST', {
        preferences: { [group]: enabled },
      })
    } finally {
      mutate()
    }
  }

  async function handleTone(enabled: boolean) {
    mutate((current) => current ? { ...current, funMode: enabled } : current, false)
    try {
      await apiSend('/api/webpush/funmode', 'POST', { funMode: enabled })
    } finally {
      mutate()
    }
  }

  async function handleTest() {
    setMsg(null)
    setTesting(true)
    try {
      const res = await apiSend<{ ok: boolean; error?: string }>('/api/webpush/test', 'POST', {})
      setMsg(res.ok
        ? { ok: true, text: 'Teste enviado. Confira o iPhone.' }
        : { ok: false, text: res.error || 'Nenhum aparelho recebeu o teste.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(false)
    }
  }

  const devices = data?.devices ?? 0
  const needsInstall = support && !support.supported && support.needsInstall

  return (
    <GlassCard className="overflow-hidden p-0">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-cyan)]/10">
            <Smartphone className="size-4 text-[color:var(--brand-cyan)]" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="section-head text-sm font-semibold text-foreground">Alertas no iPhone</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                thisDevice ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'
              }`}>
                {thisDevice ? 'Ativo neste aparelho' : 'Não ativado'}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
              A dashboard avisa quando algo importante acontece ou uma automação precisa de você.
            </p>
            {devices > 0 && (
              <p className="mt-1 text-[11px] text-faint">
                {devices === 1 ? '1 aparelho conectado' : `${devices} aparelhos conectados`}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleToggleDevice}
          disabled={busy || !support?.supported}
          className={`flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            thisDevice
              ? 'border border-border text-muted-foreground hover:bg-secondary hover:text-foreground'
              : 'bg-[color:var(--brand-cyan)] text-black hover:brightness-105'
          }`}
        >
          {busy && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
          {thisDevice ? 'Desativar' : 'Ativar no iPhone'}
        </button>
      </div>

      {needsInstall && (
        <div className="mx-5 mb-5 rounded-lg border border-[color:var(--brand-cyan)]/20 bg-[color:var(--brand-cyan)]/5 p-3">
          <p className="text-xs font-semibold text-foreground">No iPhone, faça uma vez:</p>
          <ol className="mt-1.5 list-inside list-decimal space-y-1 text-xs leading-relaxed text-muted-foreground">
            <li>Abra a dashboard no Safari</li>
            <li>Compartilhar → Adicionar à Tela de Início</li>
            <li>Abra pelo novo ícone e toque em Ativar</li>
          </ol>
        </div>
      )}
      {support && !support.supported && !support.needsInstall && (
        <p className="mx-5 mb-5 rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
          {support.reason}
        </p>
      )}

      <div className="border-t border-border/70 px-5 py-4">
        <p className="mb-2 text-xs font-semibold text-foreground">O que chega no iPhone</p>
        <div className="divide-y divide-border/50">
          {PREFERENCES.map((item) => {
            const Icon = item.icon
            const enabled = data?.preferences?.[item.key] ?? true
            return (
              <label key={item.key} className="flex cursor-pointer items-center gap-3 py-3 first:pt-1 last:pb-1">
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-foreground">{item.label}</span>
                  <span className="block text-xs leading-relaxed text-muted-foreground">{item.hint}</span>
                </span>
                <Switch
                  checked={enabled}
                  onChange={() => handlePreference(item.key, !enabled)}
                  label={item.label}
                />
              </label>
            )
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-faint">
          Simulações e ações concluídas com sucesso ficam no histórico da automação, sem gerar push.
        </p>
      </div>

      <details className="group border-t border-border/70 px-5 py-3">
        <summary className="cursor-pointer list-none text-xs font-medium text-muted-foreground marker:hidden hover:text-foreground">
          Mais opções
        </summary>
        <div className="mt-3 flex flex-col gap-3 border-t border-border/50 pt-3">
          <label className="flex cursor-pointer items-center justify-between gap-3">
            <span>
              <span className="block text-xs font-medium text-foreground">Tom descontraído</span>
              <span className="block text-[11px] text-muted-foreground">Desligado usa mensagens curtas e diretas</span>
            </span>
            <Switch
              checked={data?.funMode ?? false}
              onChange={() => handleTone(!(data?.funMode ?? false))}
              label="Tom descontraído"
            />
          </label>
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || devices === 0}
            className="flex min-h-9 w-fit items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
          >
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Enviar teste
          </button>
        </div>
      </details>

      {msg && (
        <p className={`border-t border-border/70 px-5 py-3 text-xs ${msg.ok ? 'text-success' : 'anim-shake text-destructive'}`}>
          {msg.text}
        </p>
      )}
    </GlassCard>
  )
}
