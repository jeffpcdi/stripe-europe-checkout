'use client'

import { useState, useEffect } from 'react'
import {
  User, Bell, LogOut, Loader2, Check, KeyRound, Copy, Trash2, Send, SlidersHorizontal,
} from 'lucide-react'
import useSWR from 'swr'
import { useAccount, usePushcutConfig, apiSend, fetcher } from '@/lib/api'
import { usePrefs } from '@/lib/prefs'
import type { PushcutEvents } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'

const EVENT_LABELS: { key: keyof PushcutEvents; label: string; hint: string }[] = [
  { key: 'sale', label: 'Venda aprovada', hint: 'Cada pagamento confirmado' },
  { key: 'failed', label: 'Pagamento recusado', hint: 'Cartão negado ou falha' },
  { key: 'refund', label: 'Reembolso', hint: 'Estorno processado' },
  { key: 'dispute', label: 'Chargeback', hint: 'Disputa aberta' },
  { key: 'checkout', label: 'Checkout iniciado', hint: 'Visitante chegou ao checkout' },
  { key: 'daily', label: 'Resumo diário', hint: 'Relatório consolidado 1x/dia' },
]

export function ConfigView() {
  return (
    <div className="flex flex-col gap-6">
      <AccountCard />
      <PreferencesCard />
      <PushcutCard />
      <ApiTokenCard />
      <DangerCard />
    </div>
  )
}

/** Bloco S (itens 121/122/125): preferências visuais persistidas em localStorage */
function PreferencesCard() {
  const { prefs, update } = usePrefs()

  const OPTIONS: {
    key: 'density' | 'anim' | 'privacy'
    label: string
    hint: string
    on: string
    off: string
    isOn: boolean
    toggle: () => void
  }[] = [
    {
      key: 'density',
      label: 'Modo compacto',
      hint: 'Reduz espaçamentos de cards e tabelas em ~25%',
      on: 'compact',
      off: 'comfortable',
      isOn: prefs.density === 'compact',
      toggle: () => update({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }),
    },
    {
      key: 'anim',
      label: 'Reduzir animações',
      hint: 'Desliga transições e efeitos de movimento',
      on: 'off',
      off: 'on',
      isOn: prefs.anim === 'off',
      toggle: () => update({ anim: prefs.anim === 'off' ? 'on' : 'off' }),
    },
    {
      key: 'privacy',
      label: 'Modo apresentação',
      hint: 'Borra receita e valores sensíveis para gravar tela',
      on: 'on',
      off: 'off',
      isOn: prefs.privacy === 'on',
      toggle: () => update({ privacy: prefs.privacy === 'on' ? 'off' : 'on' }),
    },
  ]

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <SlidersHorizontal className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Aparência</h2>
          <p className="text-xs text-muted-foreground">
            Preferências visuais salvas neste navegador
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        {OPTIONS.map((opt) => (
          <label key={opt.key} className="flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>
              <span className="block text-sm text-foreground">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={opt.isOn}
              aria-label={opt.label}
              onClick={opt.toggle}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${opt.isOn ? 'bg-[color:var(--brand-cyan)]' : 'bg-secondary'}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${opt.isOn ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </button>
          </label>
        ))}
      </div>
    </GlassCard>
  )
}

function ApiTokenCard() {
  const { data } = useSWR<{ token: string }>('/api/public-token', fetcher, {
    revalidateOnFocus: false,
  })
  const [copied, setCopied] = useState(false)

  const summaryUrl = data?.token
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/summary?token=${data.token}`
    : ''

  async function copy() {
    if (!summaryUrl) return
    await navigator.clipboard.writeText(summaryUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <KeyRound className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">API pública (read-only)</h2>
          <p className="text-xs text-muted-foreground">
            Para planilhas (IMPORTDATA), widgets e BI externo — sem expor a dashboard
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-secondary/60 px-3 py-2 font-mono text-xs text-muted-foreground">
          {summaryUrl || 'Carregando…'}
        </code>
        <button
          type="button"
          onClick={copy}
          disabled={!summaryUrl}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </GlassCard>
  )
}

function DangerCard() {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleReset() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setResetting(true)
    try {
      await apiSend('/api/reset-stats', 'POST', {})
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } finally {
      setResetting(false)
      setConfirming(false)
    }
  }

  return (
    /* Item 82: zona de perigo demarcada — hairline rosa + fundo rosa 3% */
    <GlassCard className="danger-zone p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <Trash2 className="size-4 text-destructive" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Zerar estatísticas</h2>
            <p className="text-xs text-muted-foreground">
              Apaga leads, eventos e séries da sua conta. Links, pixels e domínios são mantidos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
              confirming
                ? 'bg-destructive text-white hover:opacity-90'
                : 'border border-destructive/50 text-destructive hover:bg-destructive/10'
            }`}
          >
            {resetting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : done ? (
              <Check className="size-3.5" />
            ) : null}
            {done ? 'Zerado' : confirming ? 'Confirmar — apagar tudo' : 'Zerar estatísticas'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}

function AccountCard() {
  const { data: account } = useAccount()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' })
      // Login mora no Express (outro host em produção) — redirect completo
      window.location.href = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'
    } catch {
      setLoggingOut(false)
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl"
            style={{ background: 'color-mix(in oklab, var(--brand-cyan) 14%, transparent)' }}
          >
            <User className="size-5 text-[color:var(--brand-cyan)]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{account?.name || account?.email || '—'}</p>
            <p className="text-xs text-muted-foreground">
              {account?.email}
              {account?.role ? ` · ${account.role}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {loggingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
          Sair
        </button>
      </div>
    </GlassCard>
  )
}

function PushcutCard() {
  const { data, mutate } = usePushcutConfig()
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<PushcutEvents | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function handleTest() {
    setTestMsg(null)
    setTesting(true)
    try {
      await apiSend('/api/pushcut/test', 'POST', {})
      setTestMsg({ ok: true, text: 'Notificação de teste enviada — confira seu iPhone.' })
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(false)
    }
  }

  useEffect(() => {
    if (data && events === null) setEvents(data.events)
  }, [data, events])

  function toggle(key: keyof PushcutEvents) {
    if (!events) return
    setEvents({ ...events, [key]: !events[key] })
  }

  async function handleSave() {
    setError(null)
    setSaving(true)
    try {
      const body: { url?: string; events?: PushcutEvents } = { events: events ?? undefined }
      // só envia URL se o usuário digitou uma nova (não a mascarada)
      if (url.trim()) body.url = url.trim()
      await apiSend('/api/pushcut-config', 'POST', body)
      setUrl('')
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  // Item 77: underline gradiente cresce do centro ao focar
  const inputCls =
    'input-neon w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none'

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <Bell className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Notificações push (Pushcut)</h2>
          <p className="text-xs text-muted-foreground">Alertas no iPhone a cada evento importante</p>
        </div>
      </div>

      <div className="mb-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pc-url">
          Webhook do Pushcut
        </label>
        <input
          id="pc-url"
          className={inputCls}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={data?.hasUrl ? data.url : 'https://api.pushcut.io/…/notifications/…'}
        />
        {data?.hasUrl && !url && (
          <p className="mt-1 text-[11px] text-success">Webhook configurado. Deixe em branco para manter.</p>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-4">
        {EVENT_LABELS.map((ev) => (
          <label key={ev.key} className="flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>
              <span className="block text-sm text-foreground">{ev.label}</span>
              <span className="block text-xs text-muted-foreground">{ev.hint}</span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={events?.[ev.key] ?? false}
              onClick={() => toggle(ev.key)}
              className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${events?.[ev.key] ? 'bg-[color:var(--brand-cyan)]' : 'bg-secondary'}`}
            >
              <span
                className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${events?.[ev.key] ? 'translate-x-4' : 'translate-x-0.5'}`}
              />
            </button>
          </label>
        ))}
      </div>

      {/* Item 79: erro entra com shake curto; sucesso com check draw-in */}
      {error && <p className="anim-shake mt-3 text-xs text-destructive">{error}</p>}
      {testMsg && (
        <p
          className={`mt-3 text-xs ${testMsg.ok ? 'text-success' : 'anim-shake text-destructive'}`}
        >
          {testMsg.text}
        </p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || !data?.hasUrl}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Testar
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
          {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </GlassCard>
  )
}
