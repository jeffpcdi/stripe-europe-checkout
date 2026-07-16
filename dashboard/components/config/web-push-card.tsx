'use client'

// Card "Notificações no iPhone" — Web Push nativo (PWA), sem Pushcut.
// Ativa/desativa o aparelho atual, mostra quantos estão inscritos, liga o
// "modo zoeira" (copy humorada) e dispara um teste real.

import { useEffect, useState } from 'react'
import { Smartphone, Loader2, Send, BellRing, BellOff, Check } from 'lucide-react'
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
import { playSaleSound } from '@/lib/sale-alerts'

type Status = { ok: boolean; devices: number; funMode: boolean }

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
          A Apple não permite sons customizados em notificações fechadas. Mas, com a aba aberta, temos um <strong>Som Premium de Caixa Registradora</strong> via WebAudio. Toque abaixo para desbloquear o alto-falante do Safari para esta sessão.
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
          {' '}Os eventos seguem os mesmos interruptores do card Pushcut acima.
        </p>
      </div>

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
