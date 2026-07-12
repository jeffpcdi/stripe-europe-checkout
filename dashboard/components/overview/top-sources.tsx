'use client'

// Itens 286/287: rankings "top campanhas" (utm_campaign) e "top links"
// (linkSlug) na Overview — mostram de onde vêm os leads que CONVERTEM,
// não só os que chegam. Só renderiza quando há dados de origem no período
// (contas sem UTM/links rastreados não veem cards vazios).

import Link from 'next/link'
import { Megaphone, Link2, ArrowUpRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { GlassCard } from '@/components/glass-card'
import type { SourceRank } from '@/lib/metrics'
import { fmtPercent } from '@/lib/format'

function RankList({
  icon: Icon,
  title,
  rows,
  href,
  hrefLabel,
}: {
  icon: LucideIcon
  title: string
  rows: SourceRank[]
  href: string
  hrefLabel: string
}) {
  const max = Math.max(...rows.map((r) => r.leads), 1)
  return (
    <GlassCard className="p-5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="section-head flex items-center gap-2 text-sm font-semibold text-foreground">
          <Icon className="size-4 text-muted-foreground" aria-hidden="true" />
          {title}
        </h3>
        <Link
          href={href}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          {hrefLabel}
          <ArrowUpRight className="size-3" aria-hidden="true" />
        </Link>
      </div>
      <ol className="mt-3 flex flex-col gap-2.5">
        {rows.map((r, i) => (
          <li key={r.name} className="flex items-center gap-3">
            <span className="w-4 shrink-0 font-mono text-[11px] tabular-nums text-faint">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-medium text-foreground">{r.name}</span>
                <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground">
                  {r.purchased > 0 ? (
                    <>
                      <span className="text-success">{r.purchased}</span>
                      {' · '}
                      {fmtPercent(r.conv)}
                    </>
                  ) : (
                    `${r.leads} ${r.leads === 1 ? 'lead' : 'leads'}`
                  )}
                </span>
              </div>
              <div
                className="mt-1 h-1 overflow-hidden rounded-full bg-border/60"
                role="presentation"
              >
                <div
                  className="h-full rounded-full bg-primary/70"
                  style={{ width: `${Math.max(4, (r.leads / max) * 100)}%` }}
                />
              </div>
            </div>
          </li>
        ))}
      </ol>
    </GlassCard>
  )
}

export function TopSources({
  campaigns,
  links,
}: {
  campaigns: SourceRank[]
  links: SourceRank[]
}) {
  if (!campaigns.length && !links.length) return null
  return (
    <section
      aria-label="Principais origens de tráfego"
      className="grid gap-4 md:grid-cols-2"
    >
      {campaigns.length > 0 && (
        <RankList
          icon={Megaphone}
          title="Top campanhas"
          rows={campaigns}
          href="/funnel"
          hrefLabel="ver funil"
        />
      )}
      {links.length > 0 && (
        <RankList
          icon={Link2}
          title="Top links"
          rows={links}
          href="/links"
          hrefLabel="gerenciar links"
        />
      )}
    </section>
  )
}
