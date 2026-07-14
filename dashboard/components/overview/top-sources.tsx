'use client'

// Redesign: "TOP CAMPANHAS" como lista simples — nome à esquerda, número à
// direita. Sem medalhas, sem barras. Linhas com problema (macro de UTM não
// substituída, ex.: "{{campaign.name}}" ou "__CAMPAIGN_NAME__") aparecem em
// vermelho: é dinheiro sendo gasto sem atribuição. Campanhas têm prioridade;
// sem campanha no período, cai para os links rastreados.

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { SourceRank } from '@/lib/metrics'
import { GlassCard } from '@/components/glass-card'

// Macro de UTM que o TikTok NÃO substituiu chega literal ("{{campaign.name}}",
// "__CAMPAIGN_NAME__") ou vazia — qualquer uma indica atribuição quebrada.
function isBrokenUtm(name: string): boolean {
  return !name || name.includes('{') || name.includes('__') || name === '(não definida)'
}

export function TopSources({
  campaigns,
  links,
}: {
  campaigns: SourceRank[]
  links: SourceRank[]
}) {
  const useCampaigns = campaigns.length > 0
  const rows = (useCampaigns ? campaigns : links).slice(0, 6)
  if (rows.length === 0) return null

  return (
    <GlassCard className="flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
          {useCampaigns ? 'Top campanhas' : 'Top links'}
        </h3>
        <Link
          href={useCampaigns ? '/funnel' : '/links'}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {useCampaigns ? 'ver funil' : 'gerenciar'}
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </div>

      <ol className="flex flex-1 flex-col justify-center">
        {rows.map((r, i) => {
          const broken = isBrokenUtm(r.name)
          return (
            <li
              key={r.name || `linha-${i}`}
              className="anim-row-in flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5 last:border-b-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <span
                className={`truncate text-xs font-medium ${broken ? 'text-error' : 'text-foreground'}`}
                title={broken ? 'UTM quebrada — macro não substituída na origem' : undefined}
              >
                {r.name || '(sem nome)'}
                {broken ? ' · UTM quebrada' : ''}
              </span>
              <span
                className={`shrink-0 font-mono text-sm font-semibold tabular-nums ${broken ? 'text-error' : 'text-foreground'}`}
              >
                {r.purchased > 0 ? r.purchased : r.leads}
              </span>
            </li>
          )
        })}
      </ol>
    </GlassCard>
  )
}
