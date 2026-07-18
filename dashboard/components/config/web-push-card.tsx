'use client'

// Card "Notificações no iPhone" — Web Push nativo (PWA), sem Pushcut.
// Ativa/desativa o aparelho atual, mostra quantos estão inscritos, liga o
// "modo zoeira" (copy humorada) e dispara um teste real.

import { useEffect, useState } from 'react'
import { Smartphone, Loader2, Send, BellRing, BellOff, Volume2 } from 'lucide-react'
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
import { playSaleSound, playEventSound } from '@/lib/sale-alerts'
import {
  getSoundPrefs,
  setSoundPref,
  type SoundGroup,
  type SoundPrefs,
} from '@/lib/notify-prefs'

type Status = { ok: boolean; devices: number; funMode: boolean }
type EventsResp = { ok: boolean; events: Record<SoundGroup, boolean> }

/* Grupos de evento do canal Web Push (espelham server.js e notify-prefs).
   sound = timbre tocado com o painel aberto (WebAudio, sem assets). */
const EVENT_ROWS: { key: SoundGroup; label: string; hint: string; sound: string }[] = [
  { key: 'sale', label: 'Venda aprovada', hint: 'Cha-ching de caixa registradora', sound: 'cash' },
  { key: 'failed', label: 'Pagamento recusado', hint: 'Alerta grave', sound: 'alert' },
  { key: 'refund', label: 'Reembolso', hint: 'Alerta grave', sound: 'alert' },
  { key: 'dispute', label: 'Chargeback', hint: 'Alerta grave', sound: 'alert' },
  { key: 'checkout', label: 'Checkout iniciado', hint: 'Tick sutil — ruidoso, desligado por padrão', sound: 'tick' },
  { key: 'login', label: 'Novo login no painel', hint: 'Ping de segurança', sound: 'ping' },
  { key: 'ads', label: 'TikTok Ads', hint: 'Tom informativo', sound: 'info' },
  { key: 'system', label: 'Resumo & anomalias', hint: 'Resumo diário e watchdog', sound: 'info' },
]

/* Preferências por evento: push (servidor, todos os aparelhos) + som
   (localStorage, só este aparelho, com o painel aberto). */
function EventPrefs() {
  const { data, mutate } = useSWR<EventsResp>('/api/webpush/events', fetcher, {
    revalidateOnFocus: false,
  })
  const [sound, setSound] = useState<SoundPrefs | null>(null)

  useEffect(() => {
    setSound(getSoundPrefs())
  }, [])

  async function handlePush(group: SoundGroup, next: boolean) {
    // otimista: atualiza a UI e persiste em seguida
    mutate((cur) => (cur ? { ...cur, events: { ...cur.events, [group]: next } } : cur), false)
    try {
      await apiSend('/api/webpush/events', 'POST', { events: { [group]: next } })
    } finally {
      mutate()
    }
  }

  function handleSound(group: SoundGroup, next: boolean) {
    setSoundPref(group, next)
    setSound(getSoundPrefs())
    if (next) {
      const row = EVENT_ROWS.find((r) => r.key === group)
      if (row) playEventSound(row.sound) // preview imediato (e destrava o áudio)
    }
  }

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="mb-1 flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-foreground">Eventos e sons</p>
        <div className="flex items-center gap-6 pr-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span>Push</span>
          <span>Som</span>
        </div>
      </div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        Push vale para todos os aparelhos da conta. Som toca só neste aparelho, com o painel aberto.
      </p>
      <ul className="flex flex-col">
        {EVENT_ROWS.map((row) => (
          <li key={row.key} className="flex items-center justify-between gap-3 border-b border-border/50 py-2.5 last:border-b-0">
            <button
              type="button"
              onClick={() => playEventSound(row.sound)}
              className="group flex min-w-0 items-center gap-2 text-left"
              aria-label={`Ouvir som de ${row.label}`}
              title="Ouvir o som deste evento"
            >
              <Volume2 className="size-3.5 shrink-0 text-muted-foreground transition-colors group-hover:text-[color:var(--brand-cyan)]" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-foreground">{row.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{row.hint}</span>
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-4">
              <Switch
                checked={data?.events?.[row.key] ?? row.key !== 'checkout'}
                onChange={() => handlePush(row.key, !(data?.events?.[row.key] ?? row.key !== 'checkout'))}
                label={`Push de ${row.label}`}
              />
              <Switch
                checked={sound?.[row.key] ?? true}
                onChange={() => handleSound(row.key, !(sound?.[row.key] ?? true))}
                label={`Som de ${row.label}`}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function WebPushCard() {
  const { data, mutate } = useSWR<Status>('/api/webpush/status', fetcher)
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
        setMsg({ ok: true, text: 'Este aparelho não recebe mais notificações.' })
      } else {
        await subscribeDevice()
        setThisDevice(true)
        setMsg({ ok: true, text: 'Pronto! Este aparelho vai receber as notificações.' })
      }
      mutate()
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha ao ativar' })
    } finally {
      setBusy(false)
    }
  }

  async function handleFunMode(next: boolean) {
    // otimista: atualiza a UI e persiste em seguida
    mutate((cur) => (cur ? { ...cur, funMode: next } : cur), false)
    try {
      await apiSend('/api/webpush/funmode', 'POST', { funMode: next })
    } finally {
      mutate()
    }
  }

  async function handleTest() {
    setMsg(null)
    setTesting(true)
    try {
      const res = await apiSend<{ ok: boolean; error?: string }>('/api/webpush/test', 'POST', {})
      if (res.ok) setMsg({ ok: true, text: 'Teste enviado — confira a tela do seu iPhone.' })
      else setMsg({ ok: false, text: res.error || 'Nenhum aparelho recebeu o teste.' })
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(false)
    }
  }

  const devices = data?.devices ?? 0
  const needsInstall = support && !support.supported && support.needsInstall

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <Smartphone className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Notificações no iPhone</h2>
          <p className="text-xs text-muted-foreground">
            Nativas, com o logo ROI-NADOS — sem Pushcut, sem app pago
          </p>
        </div>
      </div>

      {/* Instruções de instalação no iOS (Web Push exige app na Tela de Início) */}
      {needsInstall && (
        <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3">
          <p className="text-xs font-medium text-foreground">Como ativar no iPhone (iOS 16.4+):</p>
          <ol className="mt-1.5 flex list-inside list-decimal flex-col gap-1 text-xs leading-relaxed text-muted-foreground">
            <li>Abra este painel no Safari</li>
            <li>
              Toque em <span className="text-foreground">Compartilhar</span> e depois em{' '}
              <span className="text-foreground">Adicionar à Tela de Início</span>
            </li>
            <li>Abra o app ROI-NADOS pelo novo ícone e volte aqui</li>
            <li>Toque em Ativar neste aparelho</li>
          </ol>
        </div>
      )}
      {support && !support.supported && !support.needsInstall && (
        <p className="mb-4 text-xs text-muted-foreground">{support.reason}</p>
      )}

      {/* Aviso de Áudio no iOS */}
      <div className="mb-4 rounded-lg border border-border bg-secondary/40 p-3">
        <p className="text-xs font-medium text-foreground">Sons no iPhone (Apple iOS):</p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          Com o app fechado, o iPhone toca o som padrão do sistema (limite da Apple). Com o painel aberto, cada evento tem um <strong>som próprio</strong>: cha-ching na venda, alerta grave em recusas, tick no checkout e mais. Toque abaixo para desbloquear o alto-falante do Safari nesta sessão.
        </p>
        <button
          type="button"
          onClick={() => {
            playSaleSound()
            // Feedback visual rápido
            const btn = document.activeElement as HTMLElement
            if (btn) {
              const old = btn.innerHTML
              btn.innerHTML = '<svg class="lucide lucide-check size-3" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg> Som Tocado!'
              setTimeout(() => { btn.innerHTML = old }, 1500)
            }
          }}
          className="mt-3 flex items-center gap-1.5 rounded border border-[color:var(--brand-cyan)]/30 bg-[color:var(--brand-cyan)]/10 px-3 py-1.5 text-xs font-medium text-[color:var(--brand-cyan)] transition-colors hover:bg-[color:var(--brand-cyan)]/20"
        >
          <BellRing className="size-3" />
          Testar Som Premium & Desbloquear
        </button>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex cursor-pointer items-center justify-between gap-3 py-1">
          <span>
            <span className="block text-sm text-foreground">Modo zoeira</span>
            <span className="block text-xs text-muted-foreground">
              Copy humorada nas notificações (valores e produtos reais)
            </span>
          </span>
          <Switch
            checked={data?.funMode ?? true}
            onChange={() => handleFunMode(!(data?.funMode ?? true))}
            label="Modo zoeira"
          />
        </label>
        <p className="py-1 text-xs text-muted-foreground">
          {devices === 0
            ? 'Nenhum aparelho inscrito ainda.'
            : devices === 1
              ? '1 aparelho recebendo notificações.'
              : `${devices} aparelhos recebendo notificações.`}
        </p>
      </div>

      {/* Preferências por evento: push (servidor) + som (este aparelho) */}
      <EventPrefs />

      {msg && (
        <p className={`mt-3 text-xs ${msg.ok ? 'text-success' : 'anim-shake text-destructive'}`}>{msg.text}</p>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || devices === 0}
          className="flex items-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
        >
          {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
          Testar
        </button>
        <button
          type="button"
          onClick={handleToggleDevice}
          disabled={busy || !support?.supported}
          className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none"
        >
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : thisDevice ? (
            <BellOff className="size-3.5" />
          ) : (
            <BellRing className="size-3.5" />
          )}
          {thisDevice ? 'Desativar neste aparelho' : 'Ativar neste aparelho'}
        </button>
      </div>
    </GlassCard>
  )
}
