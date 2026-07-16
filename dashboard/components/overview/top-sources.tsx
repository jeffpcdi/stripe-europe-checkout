'use client'

// Redesign: "TOP CAMPANHAS" como lista simples — nome à esquerda, número à
// direita. Sem medalhas, sem barras. Linhas com problema (macro de UTM não
// substituída, ex.: "{{campaign.name}}" ou "__CAMPAIGN_NAME__") aparecem em
// vermelho: é dinheiro sendo gasto sem atribuição. Campanhas têm prioridade;
// sem campanha no período, cai para os links rastreados.

import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import type { SourceRank } from '@/lib/metrics'
import { SectionTitle } from '@/components/section-title'
import { cleanCampaignName } from '@/lib/format'

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

  // Coerência: "Top campanhas" com 0 vendas no período inteiro é promessa
  // falsa — o número solto era 1 LEAD parecendo venda. Sem nenhuma venda,
  // o título assume o que a lista realmente mostra: tráfego.
  const anyPurchase = rows.some((r) => r.purchased > 0)

  return (
    <div className="hero-glass-panel flex h-full flex-col p-5">
      <div className="mb-4 flex items-center justify-between gap-2">
        <SectionTitle>
          {useCampaigns ? (anyPurchase ? 'Top campanhas' : 'Campanhas com tráfego') : 'Top links'}
        </SectionTitle>
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
              className="anim-feed-row group relative flex items-center justify-between gap-3 border-b border-white/[0.05] py-2.5 px-3 -mx-3 rounded-lg hover:bg-white/5 transition-colors cursor-default last:border-b-0"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <div className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-full bg-brand-cyan opacity-0 group-hover:opacity-100 transition-all shadow-[0_0_10px_rgba(37,244,238,0.8)]" aria-hidden="true" />
              <span
                className={`truncate text-xs font-medium ${broken ? 'text-error' : 'text-foreground'}`}
                title={
                  broken
                    ? 'UTM quebrada — macro não substituída na origem'
                    : r.name || undefined
                }
              >
                {broken ? r.name || '(sem nome)' : cleanCampaignName(r.name)}
                {broken ? ' · UTM quebrada' : ''}
              </span>
              {/* Rótulo explícito: o número solto fazia 1 lead parecer venda */}
              <span
                className={`shrink-0 font-mono text-xs font-semibold tabular-nums ${broken ? 'text-error' : 'text-foreground'}`}
              >
                {r.purchased > 0
                  ? `${r.leads} leads · ${r.purchased} ${r.purchased === 1 ? 'venda' : 'vendas'}`
                  : `${r.leads} ${r.leads === 1 ? 'lead' : 'leads'}`}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
