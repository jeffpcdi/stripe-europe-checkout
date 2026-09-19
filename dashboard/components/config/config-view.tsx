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
  UserRound,
  Globe2,
  Smartphone,
  ChevronRight,
  PlugZap,
} from 'lucide-react'
import * as Tabs from '@radix-ui/react-tabs'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import useSWR, { useSWRConfig } from 'swr'
import { fetcher, apiSend, useAccount, useAccountSettings } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { SecurityCard, AccountPrefsCard } from '@/components/config/account-security'
import { WebPushCard } from '@/components/config/web-push-card'
import { IPhoneCompanionCard } from '@/components/config/iphone-companion-card'
import { Switch } from '@/components/ui/switch'
import { usePrefs } from '@/lib/prefs'
import { formatDateTime } from '@/lib/format'
import { ErrorState } from '@/components/error-state'
import { Modal } from '@/components/ui/modal'
import type { AccountSettings } from '@/lib/types'
import { toast } from '@/lib/toast'
import { apiCacheKeyMatches } from '@/lib/cache-consistency'

export function ConfigView() {
  const { prefs, update } = usePrefs()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const validTabs = ['prefs', 'integrations', 'notifications', 'security', 'data'] as const
  type SettingsTabKey = (typeof validTabs)[number]
  const normalizedTab: SettingsTabKey = validTabs.includes(requestedTab as SettingsTabKey)
    ? requestedTab as SettingsTabKey
    : 'prefs'
  const [activeTab, setActiveTab] = useState<SettingsTabKey>(normalizedTab)

  useEffect(() => {
    setActiveTab((current) => current === normalizedTab ? current : normalizedTab)
  }, [normalizedTab])

  function selectTab(next: string) {
    const tab = validTabs.includes(next as SettingsTabKey) ? next as SettingsTabKey : 'prefs'
    setActiveTab(tab)
    const params = new URLSearchParams(searchParams.toString())
    if (tab === 'prefs') params.delete('tab')
    else params.set('tab', tab)
    const query = params.toString()
    router.replace(pathname + (query ? `?${query}` : ''), { scroll: false })
  }

  return (
    <div className="operation-settings flex flex-col gap-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">Conta</h1>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Preferências, integrações, alertas, segurança e dados da operação em um único lugar.</p>
        </div>
      </div>

      <SettingsOverview onSelect={selectTab} />

      <Tabs.Root value={activeTab} onValueChange={selectTab} className="grid min-w-0 gap-5 lg:grid-cols-[230px_minmax(0,1fr)] lg:items-start">
        <Tabs.List
          aria-label="Configurações da conta"
          className="settings-tabs hide-scrollbar"
        >
          <SettingsTab value="prefs" icon={SlidersHorizontal} title="Preferências" description="Interface, moeda e operação" />
          <SettingsTab value="integrations" icon={PlugZap} title="Integrações" description="Webhook e mensagens" />
          <SettingsTab value="notifications" icon={Bell} title="Alertas" description="Resumo diário e push" />
          <SettingsTab value="security" icon={Lock} title="Conta e segurança" description="Senha, 2FA e sessões" />
          <SettingsTab value="data" icon={Database} title="Dados" description="Exportação, histórico e reset" />
        </Tabs.List>

        <div className="min-w-0">
          <Tabs.Content value="prefs" className="focus:outline-none outline-none flex flex-col gap-4">
            <SectionIntro
              eyebrow="Preferências"
              title="Como a conta trabalha no dia a dia"
              description="Concentre aqui apenas ajustes que alteram a experiência, moeda, fuso, metas e retenção de dados."
            />

            <GlassCard className="p-5">
              <div className="mb-4">
                <h2 className="text-sm font-semibold text-foreground">Experiência da dashboard</h2>
                              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border/55 bg-secondary/15 p-4 transition-colors hover:border-border hover:bg-secondary/25">
                  <span>
                    <span className="block text-sm font-medium text-foreground">Reduzir animações</span>
                                      </span>
                  <Switch checked={prefs.anim === 'off'} onChange={() => update({ anim: prefs.anim === 'off' ? 'on' : 'off' })} label="Reduzir animações" />
                </label>

                <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border/55 bg-secondary/15 p-4 transition-colors hover:border-border hover:bg-secondary/25">
                  <span>
                    <span className="block text-sm font-medium text-foreground">Ocultar valores</span>
                                      </span>
                  <Switch checked={prefs.privacy === 'on'} onChange={() => update({ privacy: prefs.privacy === 'on' ? 'off' : 'on' })} label="Modo privacidade" />
                </label>
                <ActionFeedbackPreference />
              </div>
            </GlassCard>

            <AccountPrefsCard section="core" />
          </Tabs.Content>

          <Tabs.Content value="integrations" className="focus:outline-none outline-none flex flex-col gap-4">
            <SectionIntro
              eyebrow="Integrações"
              title="Saídas e mensagens da operação"
              description="Defina como o ROINADOS envia dados para sistemas externos e personalize a mensagem usada nas notificações de venda."
            />
            <AccountPrefsCard section="integrations" />
          </Tabs.Content>

          <Tabs.Content value="notifications" className="focus:outline-none outline-none flex flex-col gap-4">
            <SectionIntro
              eyebrow="Alertas"
              title="Só o que merece sua atenção"
              description="Configure os canais e o tipo de evento que pode interromper você fora da dashboard."
            />
            <DailyReportCard />
            <WebPushCard />
          </Tabs.Content>

          <Tabs.Content value="security" className="focus:outline-none outline-none flex flex-col gap-4">
            <SectionIntro
              eyebrow="Conta e segurança"
              title="Acesso e proteção da conta"
              description="Nome, senha, autenticação em duas etapas e dispositivos conectados ficam concentrados aqui."
            />
            <SecurityCard />
          </Tabs.Content>

          <Tabs.Content value="data" className="focus:outline-none outline-none flex flex-col gap-4">
            <SectionIntro
              eyebrow="Dados"
              title="Portabilidade, histórico e ações irreversíveis"
              description="Exporte informações, revise atividades e mantenha ações destrutivas separadas do restante das configurações."
            />

            <GlassCard className="p-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-brand-cyan/15 bg-brand-cyan/10 text-brand-cyan">
                    <Download className="size-4" />
                  </span>
                  <div>
                    <h2 className="text-sm font-semibold text-foreground">Cópia dos dados</h2>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">Baixe perfil, configurações, Links, Pixels, Checkouts, domínios, leads, eventos e auditoria em um único arquivo JSON.</p>
                  </div>
                </div>
                <a href="/api/account/export" download className="btn-secondary shrink-0 text-xs">
                  <Download className="size-3.5" /> Baixar cópia
                </a>
              </div>
            </GlassCard>

            <AuditCard />
            <DangerCard />
          </Tabs.Content>
        </div>
      </Tabs.Root>
    </div>
  )
}

function SettingsTab({ value, icon: Icon, title, description }: { value: string; icon: typeof SlidersHorizontal; title: string; description: string }) {
  return (
    <Tabs.Trigger
      value={value}
      className="settings-tabs__item group"
    >
      <span className="settings-tabs__icon">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 hidden text-[10px] leading-tight text-muted-foreground xl:block">{description}</span>
      </span>
      <ChevronRight className="settings-tabs__chevron" aria-hidden="true" />
    </Tabs.Trigger>
  )
}

function SectionIntro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="px-0.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
      <h2 className="mt-1 text-sm font-semibold text-foreground">{title}</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  )
}

function SettingsOverview({ onSelect }: { onSelect: (tab: string) => void }) {
  const { data: account } = useAccount()
  const { data: settings } = useAccountSettings()
  const { data: twofa } = useSWR<{ ok: boolean; enabled: boolean }>('/api/account/2fa', fetcher, { revalidateOnFocus: false })
  const { data: push } = useSWR<{ ok: boolean; devices: number }>('/api/webpush/status', fetcher, { revalidateOnFocus: false })

  const cards = [
    {
      label: 'Conta',
      value: account?.name || 'Sua conta',
      hint: settings?.defaultCurrency ? `Moeda padrão · ${settings.defaultCurrency}` : 'Carregando preferências',
      icon: UserRound,
      tone: 'default',
      tab: 'prefs',
    },
    {
      label: 'Fuso da operação',
      value: settings?.timezone ? String(settings.timezone).replace('America/', '').replace('_', ' ') : '—',
      hint: 'Usado nos cortes de dia e relatórios',
      icon: Globe2,
      tone: 'default',
      tab: 'prefs',
    },
    {
      label: 'Segurança',
      value: !twofa ? 'Verificando…' : twofa.enabled ? '2FA ativo' : '2FA desligado',
      hint: !twofa ? 'Carregando estado de segurança' : twofa.enabled ? 'Camada adicional protegendo o login' : 'Ative 2FA para proteger o acesso',
      icon: ShieldCheck,
      tone: !twofa ? 'default' : twofa.enabled ? 'success' : 'warning',
      tab: 'security',
    },
    {
      label: 'Alertas push',
      value: push ? `${push.devices || 0} ${push.devices === 1 ? 'aparelho' : 'aparelhos'}` : '—',
      hint: push?.devices ? 'Dispositivos prontos para receber alertas' : 'Nenhum dispositivo conectado',
      icon: Smartphone,
      tone: push?.devices ? 'success' : 'default',
      tab: 'notifications',
    },
  ] as const

  return (
    <GlassCard className="p-3 sm:p-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map(({ label, value, hint, icon: Icon, tone, tab }) => (
          <button type="button" key={label} onClick={() => onSelect(tab)} className={`rounded-2xl border p-3.5 text-left transition-colors hover:border-border hover:bg-secondary/25 ${tone === 'success' ? 'border-emerald-500/15 bg-emerald-500/[0.06]' : tone === 'warning' ? 'border-warning/15 bg-warning/[0.05]' : 'border-border/55 bg-secondary/15'}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
                <p className="mt-2 truncate text-sm font-semibold text-foreground">{value}</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
              </div>
              <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl border ${tone === 'success' ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400' : tone === 'warning' ? 'border-warning/20 bg-warning/10 text-warning' : 'border-white/5 bg-black/20 text-brand-cyan'}`}>
                <Icon className="size-3.5" />
              </span>
            </div>
          </button>
        ))}
      </div>
    </GlassCard>
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
      <GlassCard className="p-5 flex items-center justify-between">
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

function ActionFeedbackPreference() {
  const [enabled, setEnabled] = useState(true)
  useEffect(() => { setEnabled(localStorage.getItem('roi_action_feedback') !== 'off') }, [])
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-border/55 bg-secondary/15 p-4 transition-colors hover:border-border hover:bg-secondary/25">
      <span>
        <span className="block text-sm font-medium text-foreground">Feedback ao salvar</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">Som curto e, quando suportado, vibração após alterações importantes. Não muda o som das notificações.</span>
      </span>
      <Switch
        checked={enabled}
        onChange={(next) => {
          setEnabled(next)
          localStorage.setItem('roi_action_feedback', next ? 'on' : 'off')
        }}
        label="Feedback ao salvar"
      />
    </label>
  )
}

function DailyReportCard() {
  const { data, mutate } = useSWR<AccountSettings>('/api/settings', fetcher, { revalidateOnFocus: false })
  const { data: pushStatus } = useSWR<{ ok: boolean; devices: number }>('/api/webpush/status', fetcher, { revalidateOnFocus: false })
  const [phone, setPhone] = useState('')
  const [hour, setHour] = useState(8)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  useEffect(() => {
    if (!data || dirty) return
    setPhone(data.whatsappTo || '')
    setHour(data.dailyReportHour ?? 8)
    setEnabled(data.dailyReportEnabled === true)
  }, [data, dirty])
  async function save(event?: { preventDefault: () => void }) {
    event?.preventDefault()
    setSaving(true)
    setStatus(null)
    try {
      const payload = { dailyReportEnabled: enabled, dailyReportHour: hour, whatsappTo: phone, _baseUpdatedAt: data?.updatedAt || undefined }
      const saved = await apiSend<AccountSettings>('/api/settings', 'POST', payload)
      toast.success('Notificação diária atualizada.')
      setDirty(false)
      await mutate(saved, { revalidate: false })
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Tente novamente'
      setStatus(msg)
      toast.error?.('Falha ao salvar', { hint: msg })
    } finally {
      setSaving(false)
    }
  }
  return (
    <GlassCard className="p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-emerald-500/15 bg-emerald-500/10 text-emerald-400">
            <MessageCircle className="size-4" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold text-foreground">Resumo diário</h2>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${enabled ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'}`}>
                {enabled ? 'Ativo' : 'Desligado'}
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">Brief executivo de ontem: receita, vendas, ROAS, gasto TikTok, lucro, conversão e comparação com o dia anterior.</p>
            <p className="mt-1 text-[11px] text-faint">{pushStatus?.devices ? `Push em ${pushStatus.devices} ${pushStatus.devices === 1 ? 'aparelho' : 'aparelhos'} · ` : 'Push nos aparelhos ativados · '}WhatsApp opcional</p>
          </div>
        </div>
        <Switch checked={enabled} onChange={(val) => { setEnabled(val); setDirty(true) }} label="Ativar resumo diário" />
      </div>

      <form onSubmit={save} className="mt-5">
        <fieldset disabled={!data || saving} className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_auto]">
          <label className="rounded-2xl border border-border/55 bg-secondary/15 p-3.5 text-xs text-muted-foreground">
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em]">WhatsApp · opcional</span>
            <input className="input mt-2 w-full" type="tel" value={phone} onChange={(event) => { setPhone(event.target.value.replace(/\D/g, '')); setDirty(true) }} placeholder="5511999999999" />
            <span className="mt-2 block text-[10px]">Número com DDI e DDD.</span>
          </label>
          <label className="rounded-2xl border border-border/55 bg-secondary/15 p-3.5 text-xs text-muted-foreground">
            <span className="block text-[10px] font-medium uppercase tracking-[0.16em]">Horário</span>
            <input className="input mt-2 w-full" type="number" min="0" max="23" value={hour} onChange={(event) => { setHour(Number(event.target.value)); setDirty(true) }} />
            <span className="mt-2 block text-[10px]">Fuso configurado na conta.</span>
          </label>
          <button type="submit" className="btn-primary self-end text-xs" disabled={saving || !dirty}>
            {saving ? <Loader2 className="size-3 animate-spin" /> : null} Salvar
          </button>
        </fieldset>
        {status && <div role="status" className="mt-2 text-xs text-error">{status}</div>}
      </form>

    </GlassCard>
  )
}

function DangerCard() {
  const { mutate: mutateCache } = useSWRConfig()
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
      // O reset afeta dados compartilhados por Visão Geral, Funil, Atividade
      // e indicadores de saúde. Revalida imediatamente para nenhuma tela
      // continuar mostrando o snapshot anterior até o próximo polling.
      await Promise.all([
        mutateCache((key) => apiCacheKeyMatches(key, [
          '/api/stats',
          '/api/live',
          '/api/overview/health',
          '/api/overview/analytics',
          '/api/ads/roas',
          '/api/ads/profitability',
          '/api/ads/campaign-decisions',
        ])),
      ])
      setDone(true)
      toast.success('Estatísticas zeradas com sucesso.')
      setTimeout(() => setDone(false), 3000)
    } catch (error) {
      toast.error('Não foi possível zerar os dados.', { hint: error instanceof Error ? error.message : undefined })
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
            <h2 className="text-sm font-semibold text-foreground">Apagar histórico de desempenho</h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Remove leads e eventos usados por Visão Geral, Funil e Atividade — incluindo visitas, checkouts, vendas, falhas, reembolsos e contestações. As configurações de Links, Pixels, Checkouts e Domínios são mantidas.
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
            {done ? 'Apagado' : confirming ? 'Confirmar exclusão do histórico' : 'Apagar histórico'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}
