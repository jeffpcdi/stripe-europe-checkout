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
import { fetcher, apiSend, ApiError } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { SecurityCard, AccountPrefsCard } from '@/components/config/account-security'
import { WebPushCard } from '@/components/config/web-push-card'
import { Switch } from '@/components/ui/switch'
import { usePrefs } from '@/lib/prefs'
import { formatDateTime } from '@/lib/format'
import { ErrorState } from '@/components/error-state'
import { Modal } from '@/components/ui/modal'
import { ConfirmDialog } from '@/components/confirm-dialog'
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
  const { data, error, mutate } = useSWR<AccountSettings>('/api/settings', fetcher, { revalidateOnFocus: false })
  const [draft, setDraft] = useState<Partial<AccountSettings>>({})
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [feedback, setFeedback] = useState(true)
  useEffect(() => { try { setFeedback(localStorage.getItem('roi_action_feedback') !== 'off') } catch { /* Armazenamento privado: mantém o padrão. */ } }, [])
  const phone = draft.whatsappTo ?? data?.whatsappTo ?? ''
  const hour = draft.dailyReportHour ?? data?.dailyReportHour ?? 8
  const enabled = draft.dailyReportEnabled ?? data?.dailyReportEnabled ?? false
  const dirty = Object.keys(draft).length > 0

  async function save() {
    if (saving || !data || !dirty) return
    setSaving(true)
    setMessage(null)
    const patch = { dailyReportEnabled: enabled, dailyReportHour: hour, whatsappTo: phone }
    try {
      await apiSend('/api/settings', 'POST', patch)
      await mutate({ ...data, ...patch }, { revalidate: false })
      setDraft({})
      setMessage({ ok: true, text: 'Preferências salvas' })
      toast.success('Resumo diário atualizado')
    } catch (error) {
      setMessage({ ok: false, text: error instanceof ApiError ? error.display : 'Não foi possível salvar. Suas alterações continuam no formulário.' })
    }
    finally { setSaving(false) }
  }

  if (error && !data) return <ErrorState title="Não foi possível carregar as notificações" onRetry={() => void mutate()} />

  return (
    <GlassCard className="p-5">
      <form onSubmit={event => { event.preventDefault(); void save() }} aria-busy={!data || saving}>
      <fieldset disabled={!data || saving} className="min-w-0">
      <legend className="sr-only">Resumo diário</legend>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Resumo diário</h2>
            <p className="text-xs text-muted-foreground">Gasto e vendas no horário escolhido.</p>
          </div>
        </div>
        <Switch checked={enabled} onChange={value => setDraft(current => ({ ...current, dailyReportEnabled: value }))} label="Ativar resumo diário" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_160px] pt-1">
        <label className="text-xs text-muted-foreground">
          WhatsApp com código do país e DDD
          <input className="input mt-1 w-full" type="tel" inputMode="tel" autoComplete="tel" pattern="[0-9]{8,15}" maxLength={15} title="Use de 8 a 15 números, incluindo país e DDD" value={phone} onChange={event => setDraft(current => ({ ...current, whatsappTo: event.target.value.replace(/\D/g, '') }))} placeholder="5511999999999" />
        </label>
        <label className="text-xs text-muted-foreground">
          Hora de envio
          <select className="input mt-1 w-full" value={hour} onChange={event => setDraft(current => ({ ...current, dailyReportHour: Number(event.target.value) }))}>
            {Array.from({ length: 24 }, (_, value) => <option key={value} value={value}>{String(value).padStart(2, '0')}:00</option>)}
          </select>
        </label>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Fuso: {data?.timezone || 'America/Sao_Paulo'}</p>
      {data?.whatsapp && (!data.whatsapp.configured || !data.whatsapp.templateConfigured) && <p className="mt-3 rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">O envio por WhatsApp ainda precisa ser configurado no servidor. Salvar o número não ativa essa integração.</p>}
      <div className="settings-save-bar mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-border pt-4">
        {dirty ? <span className="mr-auto text-xs text-warning">Alterações não salvas</span> : null}
        {message && <p role="status" className={`text-xs ${message.ok ? 'text-success' : 'text-error'}`}>{message.text}</p>}
        <button type="submit" className="btn-primary text-xs" disabled={!dirty || saving}>
          {saving ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : null}{saving ? 'Salvando…' : 'Salvar resumo'}
        </button>
      </div>
      </fieldset>
      </form>
      <label className="mt-4 flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs">
        <span>
          <b className="block text-foreground font-medium">Som e vibração de confirmação</b>
          <small className="text-muted-foreground">Confirma quando uma alteração é salva.</small>
        </span>
        <Switch checked={feedback} onChange={(next) => { setFeedback(next); try { localStorage.setItem('roi_action_feedback', next ? 'on' : 'off') } catch { /* Mantém a escolha nesta tela. */ } }} label="Feedback sonoro e tátil" />
      </label>
    </GlassCard>
  )
}

function DangerCard() {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleReset() {
    if (resetting) return
    setResetting(true)
    try {
      await apiSend('/api/reset-stats', 'POST', {})
      setDone(true)
      setConfirming(false)
      toast.success('Estatísticas zeradas com sucesso.')
      setTimeout(() => setDone(false), 3000)
    } catch {
      toast.error('Não foi possível zerar os dados.')
    } finally {
      setResetting(false)
    }
  }

  return (
    <>
    <GlassCard className="p-5 border-destructive/20 bg-destructive/[0.02]">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <Trash2 className="size-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Apagar estatísticas</h2>
            <p className="text-xs text-muted-foreground">
              Remove o histórico de visitas, eventos e vendas desta conta.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setConfirming(true)}
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
            {done ? 'Zerado' : 'Apagar histórico'}
          </button>
        </div>
      </div>
    </GlassCard>
    <ConfirmDialog open={confirming} onClose={() => setConfirming(false)} onConfirm={() => void handleReset()} busy={resetting} title="Apagar todo o histórico?" description="Visitas, eventos e vendas desta conta serão removidos. Links, pixels e gateways cadastrados serão mantidos. Esta ação não pode ser desfeita pelo painel." confirmText="APAGAR" confirmLabel="Apagar histórico" />
    </>
  )
}
