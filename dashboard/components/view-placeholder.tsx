import { GlassCard } from '@/components/glass-card'

export function ViewPlaceholder({ view }: { view: string }) {
  return (
    <GlassCard className="anim-kpi-in flex min-h-64 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-sub">
        {view} — em migração
      </p>
      <p className="max-w-sm text-sm text-muted-foreground text-pretty">
        Esta view será construída em uma fase seguinte do plano. A dashboard
        legada continua disponível normalmente.
      </p>
    </GlassCard>
  )
}
