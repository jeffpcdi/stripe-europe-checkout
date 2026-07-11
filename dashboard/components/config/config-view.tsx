'use client'

import { useState, useEffect } from 'react'
import {
  User, Bell, LogOut, Loader2, Check, KeyRound, Copy, Trash2, Send, SlidersHorizontal, Coins,
  DownloadCloud, UploadCloud,
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
      <CurrencyCard />
      <PreferencesCard />
      <PushcutCard />
      <ApiTokenCard />
      <BackupCard />
      <DangerCard />
    </div>
  )
}

/** Item 231: backup self-service — exporta/importa a configuração da conta
 *  em JSON. Segredos (access tokens, secrets de webhook) NUNCA saem no
 *  arquivo; após importar, o usuário recoloca as credenciais. */
function BackupCard() {
  const [importing, setImporting] = useState(false)
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleImport(file: File) {
    setImporting(true)
    setReport(null)
    setError(null)
    try {
      const text = await file.text()
      let parsed: unknown
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new Error('O arquivo não é um JSON válido.')
      }
      const r = await apiSend<{
        ok: boolean
        report: { links: number; pixels: number; gateways: number; cloakLinks: number; erros: string[] }
      }>('/api/backup/import', 'POST', parsed as Record<string, unknown>)
      const rep = r.report
      const parts = [
        rep.links > 0 ? `${rep.links} link(s)` : null,
        rep.pixels > 0 ? `${rep.pixels} pixel(s)` : null,
        rep.gateways > 0 ? `${rep.gateways} gateway(s)` : null,
        rep.cloakLinks > 0 ? `${rep.cloakLinks} link(s) de cloaking` : null,
      ].filter(Boolean)
      setReport(
        parts.length > 0
          ? `Importado: ${parts.join(', ')}.` +
              (rep.erros.length > 0 ? ` ${rep.erros.length} item(ns) com erro.` : '') +
              ' Recoloque os access tokens dos pixels e confira os gateways.'
          : 'Nada foi importado — o arquivo estava vazio ou os itens falharam.',
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao importar o backup')
    } finally {
      setImporting(false)
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <DownloadCloud className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Backup da configuração</h2>
          <p className="text-xs text-muted-foreground">
            Exporta links, pixels, gateways e cloaker em JSON — sem segredos (tokens e secrets ficam de fora)
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <a
          href="/api/backup/export"
          download="backup-conta.json"
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <DownloadCloud className="size-3.5" aria-hidden="true" />
          Exportar backup
        </a>
        <label
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary ${importing ? 'pointer-events-none opacity-50' : ''}`}
        >
          {importing ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <UploadCloud className="size-3.5" aria-hidden="true" />
          )}
          {importing ? 'Importando…' : 'Importar backup'}
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImport(f)
              e.target.value = ''
            }}
          />
        </label>
      </div>
      {report && (
        <p className="mt-3 text-xs text-success" role="status">
          {report}
        </p>
      )}
      {error && (
        <p className="anim-shake mt-3 text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </GlassCard>
  )
}

// Moedas mais comuns no público do app (LATAM + principais globais)
const CURRENCIES: { code: string; label: string }[] = [
  { code: 'BRL', label: 'Real brasileiro (R$)' },
  { code: 'USD', label: 'Dólar americano (US$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'Libra esterlina (£)' },
  { code: 'MXN', label: 'Peso mexicano (MX$)' },
  { code: 'ARS', label: 'Peso argentino (AR$)' },
  { code: 'COP', label: 'Peso colombiano (CO$)' },
  { code: 'CLP', label: 'Peso chileno (CL$)' },
  { code: 'PEN', label: 'Sol peruano (S/)' },
]

/** Item 30: moeda padrão da conta — alimenta disparos e testes da Events API */
function CurrencyCard() {
  const { data, mutate } = useSWR<{ defaultCurrency: string }>('/api/settings', fetcher, {
    revalidateOnFocus: false,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(code: string) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await apiSend('/api/settings', 'POST', { defaultCurrency: code })
      await mutate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar moeda')
    } finally {
      setSaving(false)
    }
  }

  const current = data?.defaultCurrency ?? 'BRL'

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <Coins className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Moeda da conta</h2>
          <p className="text-xs text-muted-foreground">
            Usada nos eventos enviados ao TikTok quando o gateway não informa a moeda
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <select
          value={current}
          onChange={(e) => handleChange(e.target.value)}
          disabled={saving || !data}
          aria-label="Moeda padrão da conta"
          className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.label}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Salvando" />}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success" role="status">
            <Check className="size-3.5" /> Moeda salva
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    </GlassCard>
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
