'use client'

import { useEffect, useState } from 'react'
import {
  SlidersHorizontal,
  Bell,
  Lock,
  Database,
  Loader2,
  Trash2,
  Download,
  Fingerprint,
  MessageCircle,
  ShieldCheck,
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import useSWR from 'swr'
import { fetcher, apiSend } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { SecurityCard, AccountPrefsCard } from '@/components/config/account-security'
import { WebPushCard } from '@/components/config/web-push-card'
import { Switch } from '@/components/ui/switch'
import { usePrefs } from '@/lib/prefs'
import { formatDateTime } from '@/lib/format'
import { ErrorState } from '@/components/error-state'
import { Modal } from '@/components/ui/modal'
import type { AccountSettings } from '@/lib/types'
import { toast } from '@/lib/toast'

export function ConfigView() {
  const { prefs, update } = usePrefs()

  return (
    <div className="project-page project-page--config flex flex-col gap-6">
      <Tabs.Root defaultValue="prefs" className="flex flex-col gap-6">
        <Tabs.List aria-label="Configurações da conta" className="universe-tabs grid grid-cols-2 sm:flex items-center gap-1.5 rounded-2xl bg-white/[0.03] p-1.5 backdrop-blur-md border border-white/5 hide-scrollbar w-full max-w-full sm:w-max">
          <Tabs.Trigger
            value="prefs"
            className="universe-tab flex h-9 shrink-0 items-center gap-2 justify-center rounded-xl px-4 text-xs font-semibold text-muted-foreground transition-all hover:text-white data-[state=active]:bg-white/10 data-[state=active]:text-white focus:outline-none"
          >
            <SlidersHorizontal className="size-3.5" />
            Preferências
          </Tabs.Trigger>
          <Tabs.Trigger
            value="notifications"
            className="universe-tab flex h-9 shrink-0 items-center gap-2 justify-center rounded-xl px-4 text-xs font-semibold text-muted-foreground transition-all hover:text-white data-[state=active]:bg-white/10 data-[state=active]:text-white focus:outline-none"
          >
            <Bell className="size-3.5" />
            Notificações
          </Tabs.Trigger>
          <Tabs.Trigger
            value="security"
            className="universe-tab flex h-9 shrink-0 items-center gap-2 justify-center rounded-xl px-4 text-xs font-semibold text-muted-foreground transition-all hover:text-white data-[state=active]:bg-white/10 data-[state=active]:text-white focus:outline-none"
          >
            <Lock className="size-3.5" />
            Sua conta
          </Tabs.Trigger>
          <Tabs.Trigger
            value="data"
            className="universe-tab flex h-9 shrink-0 items-center gap-2 justify-center rounded-xl px-4 text-xs font-semibold text-muted-foreground transition-all hover:text-white data-[state=active]:bg-white/10 data-[state=active]:text-white focus:outline-none"
          >
            <Database className="size-3.5" />
            Dados
          </Tabs.Trigger>
        </Tabs.List>

        {/* ABA 1: PREFERÊNCIAS */}
        <Tabs.Content value="prefs" className="focus:outline-none outline-none flex flex-col gap-4">
          <GlassCard className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Aparência</h2>
              <p className="text-xs text-muted-foreground">Deixe o painel confortável para você.</p>
            </div>
            <div className="flex flex-col gap-2 divide-y divide-border/30">
              <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5 rounded-lg hover:bg-secondary/20 px-2 transition-colors">
                <span>
                  <span className="block text-sm font-medium text-foreground">Reduzir animações</span>
                  <span className="block text-xs text-muted-foreground">Desliga transições e efeitos de movimento</span>
                </span>
                <Switch checked={prefs.anim === 'off'} onChange={() => update({ anim: prefs.anim === 'off' ? 'on' : 'off' })} label="Reduzir animações" />
              </label>

              <label className="flex cursor-pointer items-center justify-between gap-3 pt-3 py-2.5 rounded-lg hover:bg-secondary/20 px-2 transition-colors">
                <span>
                  <span className="block text-sm font-medium text-foreground">Ocultar valores</span>
                  <span className="block text-xs text-muted-foreground">Oculta valores de faturamento na tela para gravações</span>
                </span>
                <Switch checked={prefs.privacy === 'on'} onChange={() => update({ privacy: prefs.privacy === 'on' ? 'off' : 'on' })} label="Modo privacidade" />
              </label>
            </div>
          </GlassCard>

          <AccountPrefsCard />
        </Tabs.Content>

        {/* ABA 2: NOTIFICAÇÕES */}
        <Tabs.Content value="notifications" className="focus:outline-none outline-none flex flex-col gap-4">
          <DailyReportCard />
          <WebPushCard />
        </Tabs.Content>

        {/* ABA 3: SEGURANÇA */}
        <Tabs.Content value="security" className="focus:outline-none outline-none flex flex-col gap-4">
          <SecurityCard />
        </Tabs.Content>

        {/* ABA 4: DADOS E BACKUP */}
        <Tabs.Content value="data" className="focus:outline-none outline-none flex flex-col gap-4">
          <GlassCard className="p-5">
            <div className="mb-4">
              <h2 className="text-sm font-semibold text-foreground">Cópia dos dados</h2>
              <p className="text-xs text-muted-foreground">Baixe uma cópia dos seus links e configurações.</p>
            </div>
            <div className="flex items-center justify-between gap-4 pt-1">
              <div>
                <span className="block text-xs font-medium text-foreground">Exportar dados</span>
                <span className="block text-xs text-muted-foreground">Links e configurações em um arquivo JSON</span>
              </div>
              <a
                href="/api/account/export"
                download
                className="flex items-center gap-1.5 rounded-lg border border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
              >
                <Download className="size-3.5" /> Baixar cópia
              </a>
            </div>
          </GlassCard>

          <AuditCard />
          <DangerCard />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  )
}

// ── COMPONENTES AUXILIARES PRESERVADOS ──

const AUDIT_LABELS: Record<string, string> = {
  login: 'Login no painel',
  reset_stats: 'Estatísticas zeradas',
  link_salvo: 'Link salvo',
  link_removido: 'Link removido',
  backup_importado: 'Backup importado',
}

interface AuditRow {
  id: string
  at: string
  action: string
  detail: string | null
  ip: string | null
}

function AuditCard() {
  const [open, setOpen] = useState(false)
  const { data, error, mutate } = useSWR<{ ok: boolean; enabled: boolean; log: AuditRow[] }>(
    open ? '/api/audit?limit=30' : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <>
      <GlassCard 
        className="p-5 flex items-center justify-between cursor-pointer transition-colors hover:bg-secondary/40" 

      >
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-secondary border border-border">
             <Fingerprint className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Histórico de ações</h2>
            <p className="text-xs text-muted-foreground">Histórico de ações recentes realizadas no painel</p>
          </div>
        </div>
        <button type="button" onClick={() => setOpen(true)} className="btn-ghost text-xs font-semibold text-brand-cyan">
          Ver histórico
        </button>
      </GlassCard>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Histórico de ações" description="Ações recentes registradas" maxWidth="max-w-xl">
        {error ? <ErrorState onRetry={() => mutate()} /> : !data ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Carregando...</p>
        ) : data.log.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma atividade recente encontrada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40 border-t border-border pt-1 max-h-[60vh] overflow-y-auto pr-2">
            {data.log.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 py-2.5 text-xs">
                <span className="shrink-0 font-semibold text-foreground">
                  {AUDIT_LABELS[r.action] || r.action}
                </span>
                {r.detail ? <span className="truncate text-muted-foreground">{r.detail}</span> : null}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                  <span>{formatDateTime(r.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}

function DailyReportCard() {
  const { data, mutate } = useSWR<AccountSettings>('/api/settings', fetcher, { revalidateOnFocus: false })
  const [phone, setPhone] = useState('')
  const [hour, setHour] = useState(8)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(true)
  useEffect(() => { setFeedback(localStorage.getItem('roi_action_feedback') !== 'off') }, [])
  useEffect(() => {
    if (!data) return
    setPhone(data.whatsappTo || '')
    setHour(data.dailyReportHour ?? 8)
    setEnabled(data.dailyReportEnabled === true)
  }, [data])
  async function save() {
    setSaving(true)
    try {
      await apiSend('/api/settings', 'POST', { dailyReportEnabled: enabled, dailyReportHour: hour, whatsappTo: phone })
      toast.success('Notificação diária atualizada.')
      await mutate()
    } catch (error) { toast.error('Falha ao salvar', { hint: error instanceof Error ? error.message : undefined }) }
    finally { setSaving(false) }
  }
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Resumo diário</h2>
            <p className="text-xs text-muted-foreground">Receba gasto, vendas e lucro automaticamente todos os dias.</p>
          </div>
        </div>
        <Switch checked={enabled} onChange={setEnabled} label="Ativar resumo diário" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_100px_auto] pt-1">
        <label className="text-xs text-muted-foreground">
          WhatsApp com DDD
          <input className="input mt-1 w-full" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} placeholder="5511999999999" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hora de envio (fuso da conta)
          <input className="input mt-1 w-full" type="number" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} />
        </label>
        <button type="button" className="btn-primary self-end text-xs" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : null} Salvar
        </button>
      </div>
      <label className="mt-4 flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
        <span>
          <b className="block text-foreground font-medium">Som e vibração de confirmação</b>
          <small className="text-muted-foreground">Confirma quando uma alteração é salva.</small>
        </span>
        <Switch checked={feedback} onChange={(next) => { setFeedback(next); localStorage.setItem('roi_action_feedback', next ? 'on' : 'off') }} label="Feedback sonoro e tátil" />
      </label>
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
      toast.success('Estatísticas zeradas com sucesso.')
      setTimeout(() => setDone(false), 3000)
    } catch {
      toast.error('Não foi possível zerar os dados.')
    } finally {
      setResetting(false)
      setConfirming(false)
    }
  }

  return (
    <GlassCard className="p-5 border-destructive/20 bg-destructive/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Apagar estatísticas</h2>
            <p className="text-xs text-muted-foreground">
              Limpa o histórico de cliques e visitas. Links, checkouts e pixels cadastrados são mantidos.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancelar
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
              confirming
                ? 'bg-destructive text-white hover:opacity-90'
                : 'border border-destructive/40 text-destructive hover:bg-destructive/10'
            }`}
          >
            {resetting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : done ? (
              <ShieldCheck className="size-3.5" />
            ) : null}
            {done ? 'Zerado' : confirming ? 'Confirmar e Zerar Agora' : 'Zerar Histórico'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}
