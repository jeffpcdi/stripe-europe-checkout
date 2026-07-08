'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { User, Bell, LogOut, Loader2, Check } from 'lucide-react'
import { useAccount, usePushcutConfig, apiSend } from '@/lib/api'
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
      <PushcutCard />
    </div>
  )
}

function AccountCard() {
  const { data: account } = useAccount()
  const router = useRouter()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' })
      router.push('/login')
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

  const inputCls =
    'w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none'

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <Bell className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">Notificações push (Pushcut)</h2>
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

      {error && <p className="mt-3 text-xs text-destructive">{error}</p>}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : saved ? <Check className="size-3.5" /> : null}
          {saved ? 'Salvo' : 'Salvar'}
        </button>
      </div>
    </GlassCard>
  )
}
