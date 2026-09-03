'use client'

import { memo, useState, useEffect } from 'react'
import { Globe2, Activity, Zap, CreditCard, ChevronDown } from 'lucide-react'
import { useStats } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { CountUp } from '@/components/count-up'
import { formatMoney, timeAgo } from '@/lib/format'
import type { StatsEvent } from '@/lib/types'

// Mock de posições no mapa baseadas nos últimos eventos
function generatePingStyles(index: number) {
  const top = 20 + (Math.sin(index * 45) * 40 + 40) // 20% to 100%
  const left = 10 + (Math.cos(index * 90) * 40 + 40) // 10% to 90%
  return { top: `${top}%`, left: `${left}%` }
}

export function ActivityView() {
  const { data, isLoading } = useStats()
  const events = data?.events ?? []

  // Pegamos as vendas mais recentes para o Radar
  const recentSales = events.filter(e => e.type === 'sale').slice(0, 5)
  const activeVisitors = Math.max(0, Math.floor(events.filter(e => e.type === 'visit').length / 2))

  if (isLoading && !data) {
    return <Skeleton className="h-[60vh] w-full rounded-2xl" />
  }

  return (
    <div className="flex flex-col gap-6 pt-2 pb-20 h-[calc(100vh-100px)]">
      <GlassCard className="relative overflow-hidden flex-1 border-[color:var(--brand-cyan)]/30 shadow-[0_0_40px_rgba(37,244,238,0.05)] flex flex-col">
        {/* BACKGROUND GLOW */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-[500px] rounded-full bg-[color:var(--brand-cyan)]/10 blur-[100px]" />
        <div className="pointer-events-none absolute -left-20 -bottom-20 size-[500px] rounded-full bg-[color:var(--success)]/10 blur-[100px]" />

        {/* HEADER */}
        <div className="relative z-10 p-6 sm:p-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-black/50 border border-[color:var(--brand-cyan)]/30 shadow-inner">
              <Globe2 className="size-6 text-[color:var(--brand-cyan)] drop-shadow-[0_0_10px_rgba(37,244,238,0.8)]" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
                Radar de Escala
              </h2>
              <p className="text-sm text-[color:var(--brand-cyan)] flex items-center gap-1.5 font-mono">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[color:var(--brand-cyan)] opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-[color:var(--brand-cyan)]"></span>
                </span>
                LIVE SIGNAL ACTIVE
              </p>
            </div>
          </div>
          <div className="text-right">
            <span className="block text-3xl font-black text-foreground drop-shadow-md">
              <CountUp value={activeVisitors} />
            </span>
            <span className="text-xs text-muted-foreground uppercase tracking-widest font-bold">Visitantes Agora</span>
          </div>
        </div>

        {/* RADAR MAP AREA */}
        <div className="relative flex-1 flex items-center justify-center w-full min-h-[300px]">
          {/* Simulated Radar Grid */}
          <div className="absolute inset-0 flex items-center justify-center opacity-20">
            <div className="size-[200px] sm:size-[400px] rounded-full border border-[color:var(--brand-cyan)]" />
            <div className="absolute size-[400px] sm:size-[600px] rounded-full border border-[color:var(--brand-cyan)] opacity-50" />
            <div className="absolute size-[600px] sm:size-[800px] rounded-full border border-[color:var(--brand-cyan)] opacity-20" />
            <div className="absolute w-full h-[1px] bg-[color:var(--brand-cyan)]" />
            <div className="absolute h-full w-[1px] bg-[color:var(--brand-cyan)]" />
          </div>

          {/* Live Pings (Sales) */}
          {recentSales.map((sale, i) => (
            <div key={sale.id} className="absolute animate-in zoom-in duration-700" style={generatePingStyles(i)}>
              <span className="relative flex h-4 w-4">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                <span className="relative inline-flex rounded-full h-4 w-4 bg-success border border-white"></span>
              </span>
              
              {/* Tooltip Hover */}
              <div className="absolute left-6 top-1/2 -translate-y-1/2 whitespace-nowrap bg-black/80 backdrop-blur-md border border-success/30 rounded-lg p-2 shadow-lg">
                <p className="text-xs font-bold text-success flex items-center gap-1">
                  <CreditCard className="size-3" />
                  {sale.amount ? formatMoney(sale.amount, sale.currency) : 'Venda!'}
                </p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(sale.at)}</p>
              </div>
            </div>
          ))}

          {/* Radar Scanner Animation */}
          <div className="absolute inset-0 origin-center animate-[spin_4s_linear_infinite] opacity-30 pointer-events-none">
            <div className="w-1/2 h-1/2 bg-gradient-to-br from-[color:var(--brand-cyan)] to-transparent" style={{ clipPath: 'polygon(100% 100%, 100% 0, 0 100%)' }} />
          </div>
        </div>

        {/* RECENT ACTIVITY TICKER */}
        <div className="relative z-10 border-t border-border/50 bg-black/20 backdrop-blur-sm p-4 overflow-hidden">
          <div className="flex gap-4 items-center whitespace-nowrap animate-[scrollX_30s_linear_infinite]">
            {events.slice(0, 15).map(e => (
              <div key={e.id} className="flex items-center gap-2 bg-secondary/50 rounded-full px-4 py-1.5 text-xs">
                <span className={`size-2 rounded-full ${e.type === 'sale' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.8)]' : e.type === 'visit' ? 'bg-primary' : 'bg-muted-foreground'}`} />
                <span className="font-mono text-muted-foreground">{timeAgo(e.at)}</span>
                <span className="font-bold text-foreground">
                  {e.type === 'sale' ? (e.amount ? formatMoney(e.amount, e.currency) : 'Nova Venda') : e.title || e.type}
                </span>
              </div>
            ))}
            {/* Duplicado para loop contínuo */}
            {events.slice(0, 15).map(e => (
              <div key={e.id + '-dup'} className="flex items-center gap-2 bg-secondary/50 rounded-full px-4 py-1.5 text-xs">
                <span className={`size-2 rounded-full ${e.type === 'sale' ? 'bg-success shadow-[0_0_8px_rgba(34,197,94,0.8)]' : e.type === 'visit' ? 'bg-primary' : 'bg-muted-foreground'}`} />
                <span className="font-mono text-muted-foreground">{timeAgo(e.at)}</span>
                <span className="font-bold text-foreground">
                  {e.type === 'sale' ? (e.amount ? formatMoney(e.amount, e.currency) : 'Nova Venda') : e.title || e.type}
                </span>
              </div>
            ))}
          </div>
          <style dangerouslySetInnerHTML={{__html: `
            @keyframes scrollX {
              0% { transform: translateX(0); }
              100% { transform: translateX(-50%); }
            }
          `}} />
        </div>
      </GlassCard>
    </div>
  )
}
