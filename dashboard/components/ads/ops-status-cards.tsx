'use client'

// Painel de operação do topo do TikTok Ads: 3 cards de status clicáveis
// (Automação, Alertas, Fila de operações) que substituem a antiga fileira de
// botões iguais. Cada card resume o estado e abre o dialog correspondente.
// Só apresentação — consome os mesmos hooks/endpoints já existentes.

import { Bot, BellRing, ListChecks, AlertTriangle } from 'lucide-react'
import { useAdsRules, useAdsAlerts, useAdsOpsJobs } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'

// Um card de status: ícone + rótulo, número grande, linha de apoio. O estado
// `alert` pinta a borda/os números de vermelho para puxar o olhar.
function StatusCard({
  icon,
  label,
  value,
  hint,
  alert,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  value: React.ReactNode
  hint: string
  alert?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} className="group text-left">
      <GlassCard
        hover
        className={`anim-kpi-in flex items-center gap-3 p-4 transition-colors ${
          alert ? 'border-error/40 bg-error/5' : 'group-hover:border-primary/30'
        }`}
      >
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${
            alert ? 'bg-error/15 text-error' : 'bg-[var(--accent-light)] text-brand-cyan'
          }`}
        >
          {icon}
        </span>
        <div className="min-w-0">
          <p className="label-mono text-[10px]">{label}</p>
          <p
            className={`mt-0.5 text-lg font-semibold leading-none tabular-nums ${
              alert ? 'text-error' : 'text-foreground'
            }`}
          >
            {value}
          </p>
          <p className="mt-1 truncate text-[11px] text-muted-foreground">{hint}</p>
        </div>
      </GlassCard>
    </button>
  )
}

export function OpsStatusCards({
  active,
  onOpenAutomation,
  onOpenAlerts,
  onOpenOps,
}: {
  active: boolean
  onOpenAutomation: () => void
  onOpenAlerts: () => void
  onOpenOps: () => void
}) {
  const { data: rulesData } = useAdsRules(active)
  const { data: alertsData } = useAdsAlerts(active)
  const { data: jobsData } = useAdsOpsJobs(active)

  // Automação: regras ligadas + quantas dispararam hoje (log do dia)
  const rules = rulesData?.rules ?? []
  const activeRules = rules.filter((r) => r.enabled).length
  const today = new Date().toISOString().slice(0, 10)
  const firedToday = (rulesData?.log ?? []).filter((l) => (l.at || '').slice(0, 10) === today).length

  // Alertas: sem varredura no load — mostra o estado da config. Vermelho quando
  // o monitoramento está desligado (nenhuma proteção ativa).
  const alertsCfg = alertsData
  const alertsOff = Boolean(alertsCfg) && !alertsCfg?.enabled
  const configuredChecks = alertsCfg
    ? [alertsCfg.spendNoConv > 0, alertsCfg.cpaMax > 0].filter(Boolean).length
    : 0

  // Fila: jobs pendentes/rodando
  const jobs = jobsData?.jobs ?? []
  const pendingJobs = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'running' || j.status === 'retrying',
  ).length

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatusCard
        icon={<Bot className="size-4" aria-hidden="true" />}
        label="Automação"
        value={activeRules}
        hint={
          activeRules === 0
            ? 'Nenhuma regra ativa'
            : `${activeRules} regra${activeRules === 1 ? '' : 's'} ativa${activeRules === 1 ? '' : 's'} · ${firedToday} disparo${firedToday === 1 ? '' : 's'} hoje`
        }
        onClick={onOpenAutomation}
      />
      <StatusCard
        icon={
          alertsOff ? (
            <AlertTriangle className="size-4" aria-hidden="true" />
          ) : (
            <BellRing className="size-4" aria-hidden="true" />
          )
        }
        label="Alertas"
        value={alertsOff ? 'Off' : configuredChecks}
        hint={
          alertsOff
            ? 'Monitoramento desligado'
            : configuredChecks === 0
              ? 'Ativo · nenhum limite definido'
              : `${configuredChecks} verificação${configuredChecks === 1 ? '' : 'ões'} ativa${configuredChecks === 1 ? '' : 's'}`
        }
        alert={alertsOff}
        onClick={onOpenAlerts}
      />
      <StatusCard
        icon={<ListChecks className="size-4" aria-hidden="true" />}
        label="Fila de operações"
        value={pendingJobs}
        hint={
          pendingJobs === 0
            ? 'Nenhum job em andamento'
            : `${pendingJobs} job${pendingJobs === 1 ? '' : 's'} pendente${pendingJobs === 1 ? '' : 's'}/rodando`
        }
        alert={pendingJobs > 0}
        onClick={onOpenOps}
      />
    </div>
  )
}
