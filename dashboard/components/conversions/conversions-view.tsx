'use client'

// Aba "Conversões" — funde Gateways e Pixels numa tela só, porque trabalham
// juntos: o gateway confirma a venda (webhook) e o pixel dispara o evento na
// CAPI do TikTok. Em vez de duas abas separadas, um strip do fluxo no topo +
// dois segmentos (?tab=gateways|pixels) que reusam as views existentes.
import { useEffect, useMemo, useState } from 'react'
import { CreditCard, Target, ArrowRight, ListChecks, Radio } from 'lucide-react'
import { GatewaysView } from '@/components/gateways/gateways-view'
import { PixelsView } from '@/components/pixels/pixels-view'
import { useGateways, useOps, usePixelHealth } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'

type Seg = 'gateways' | 'pixels'

export function ConversionsView() {
  const [seg, setSeg] = useState<Seg>('gateways')

  // Deep-link ?tab=gateways|pixels (mesmo padrão da aba TikTok Ads): honra a
  // query no mount e no voltar/avançar do navegador. window.location para não
  // exigir Suspense.
  useEffect(() => {
    const read = () => {
      const t = new URLSearchParams(window.location.search).get('tab')
      setSeg(t === 'pixels' ? 'pixels' : 'gateways')
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  function changeSeg(value: Seg) {
    setSeg(value)
    const url = new URL(window.location.href)
    if (value === 'gateways') url.searchParams.delete('tab')
    else url.searchParams.set('tab', value)
    window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`)
  }

  return (
    <div className="flex flex-col gap-5">
      <FlowStrip onGo={changeSeg} />

      <div role="tablist" aria-label="Conversões" className="flex gap-1 rounded-xl border border-border bg-secondary/40 p-1">
        {([
          { value: 'gateways' as const, label: 'Gateways', icon: CreditCard },
          { value: 'pixels' as const, label: 'Pixels', icon: Target },
        ]).map((s) => {
          const Icon = s.icon
          const active = seg === s.value
          return (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => changeSeg(s.value)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors ${
                active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              {s.label}
            </button>
          )
        })}
      </div>

      {seg === 'gateways' ? <GatewaysView /> : <PixelsView />}
    </div>
  )
}

// Strip do fluxo Venda → Fila → Pixel, com 3 métricas ao vivo. É a cola visual
// de "gateways e pixels trabalham juntos": cada hop clica para o segmento certo.
function FlowStrip({ onGo }: { onGo: (s: Seg) => void }) {
  const { data: gwData } = useGateways()
  const { data: ops } = useOps()
  const { data: health } = usePixelHealth()

  const gwErrors = useMemo(
    () => (gwData?.gateways ?? []).filter((g) => g.lastEventAt && g.lastEventStatus !== 'ok').length,
    [gwData],
  )
  const queue = (ops?.convQueue?.queue ?? 0) + (ops?.convQueue?.processing ?? 0) + (ops?.capiRetry?.count ?? 0)
  const rate = health?.rate

  return (
    <GlassCard className="p-4">
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Radio className="size-3.5 text-[color:var(--brand-cyan)]" aria-hidden="true" />
        Fluxo da conversão
      </div>
      <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
        <FlowHop
          icon={CreditCard}
          label="Gateway confirma a venda"
          value={gwErrors > 0 ? `${gwErrors} com erro` : 'recebendo webhooks'}
          tone={gwErrors > 0 ? 'error' : 'ok'}
          onClick={() => onGo('gateways')}
        />
        <ArrowRight className="hidden size-4 shrink-0 self-center text-muted-foreground sm:block" aria-hidden="true" />
        <FlowHop
          icon={ListChecks}
          label="Fila de processamento"
          value={queue > 0 ? `${queue} na fila` : 'vazia'}
          tone={queue >= 20 ? 'warn' : 'muted'}
        />
        <ArrowRight className="hidden size-4 shrink-0 self-center text-muted-foreground sm:block" aria-hidden="true" />
        <FlowHop
          icon={Target}
          label="Pixel dispara na CAPI"
          value={rate == null ? 'sem disparos' : `${Math.round(rate)}% ok`}
          tone={rate == null ? 'muted' : rate >= 90 ? 'ok' : rate >= 60 ? 'warn' : 'error'}
          onClick={() => onGo('pixels')}
        />
      </div>
    </GlassCard>
  )
}

const TONE: Record<string, string> = {
  ok: 'text-[color:var(--success)]',
  warn: 'text-[color:var(--warning)]',
  error: 'text-[color:var(--error)]',
  muted: 'text-muted-foreground',
}

function FlowHop({
  icon: Icon,
  label,
  value,
  tone,
  onClick,
}: {
  icon: typeof CreditCard
  label: string
  value: string
  tone: keyof typeof TONE | string
  onClick?: () => void
}) {
  const inner = (
    <div className="flex flex-1 items-center gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2">
      <Icon className={`size-4 shrink-0 ${TONE[tone] ?? TONE.muted}`} aria-hidden="true" />
      <div className="min-w-0">
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
        <p className={`truncate text-xs font-semibold ${TONE[tone] ?? 'text-foreground'}`}>{value}</p>
      </div>
    </div>
  )
  if (!onClick) return inner
  return (
    <button type="button" onClick={onClick} className="flex flex-1 text-left transition-transform hover:scale-[1.01]">
      {inner}
    </button>
  )
}
