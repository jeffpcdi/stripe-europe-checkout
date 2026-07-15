'use client'

/**
 * Análise de criativos vencedores — a IA olha os top anúncios do espelho Neon
 * (HOJE; cai para 7d se o dia ainda não tem 3 anúncios com gasto), explica os
 * padrões que os fazem performar e sugere variações de copy.
 *
 * Cache de 24h no SERVIDOR (o botão "Reanalisar" força regeneração). Carregado
 * sob demanda: o fetch só acontece quando o usuário expande o painel — sem
 * custo de IA para quem nunca abre.
 */

import { useState } from 'react'
import { useAdsCreativeInsights } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'
import { fmtSpend, fmtPercent } from '@/lib/format'

export function CreativeInsightsCard({
  adAccountId,
  currency,
}: {
  adAccountId: string
  currency: string
}) {
  const [open, setOpen] = useState(false)
  const [forcing, setForcing] = useState(false)
  // fetch condicional: nada é buscado (nem gasto com IA) antes de abrir
  const { data, error, mutate, isValidating } = useAdsCreativeInsights(open, adAccountId)

  // 503 = IA não configurada no servidor: esconde o recurso inteiro
  const aiOff = error != null && /não configurada|AI_NOT_CONFIGURED/i.test(String(error.message ?? error))
  if (aiOff) return null

  async function reanalyze() {
    setForcing(true)
    try {
      const qs = new URLSearchParams({ adAccountId, force: '1' })
      const res = await fetch(`/api/ads/creatives/insights?${qs.toString()}`, { credentials: 'include' })
      if (res.ok) await mutate(await res.json(), { revalidate: false })
    } finally {
      setForcing(false)
    }
  }

  return (
    <GlassCard className="p-4">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left"
          aria-expanded={open}
        >
          <p className="label-mono">Criativos vencedores (IA)</p>
          <span className="text-[10px] text-muted-foreground">{open ? '▾' : '▸'}</span>
        </button>
        {open && data && !data.insufficient && (
          <button
            type="button"
            onClick={reanalyze}
            disabled={forcing || isValidating}
            className="rounded-lg border border-border bg-secondary px-2.5 py-1 text-[11px] font-medium text-secondary-foreground transition-colors hover:bg-secondary/70 disabled:opacity-50"
          >
            {forcing ? 'Analisando…' : 'Reanalisar'}
          </button>
        )}
      </div>

      {open && (
        <div className="mt-3">
          {!data && !error && <p className="text-xs text-muted-foreground">Analisando seus anúncios…</p>}
          {error && !aiOff && (
            <p className="text-xs text-red-400">Falha ao analisar: {String(error.message ?? error)}</p>
          )}

          {data?.insufficient && (
            <p className="text-xs text-muted-foreground">
              Dados insuficientes: preciso de pelo menos 3 anúncios com gasto (hoje ou nos últimos 7
              dias) para detectar padrões.
            </p>
          )}

          {data && !data.insufficient && (
            <div className="flex flex-col gap-4">
              {/* top ads que embasaram a análise */}
              {data.topAds && data.topAds.length > 0 && (
                <div className="flex flex-col gap-1">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Base da análise ({data.topAds.length} anúncios,{' '}
                    {data.windowDays === 1 ? 'hoje' : `últimos ${data.windowDays ?? 7} dias`})
                  </p>
                  <ul className="flex flex-col gap-1">
                    {data.topAds.slice(0, 5).map((ad) => (
                      <li
                        key={ad.adId}
                        className="flex items-baseline justify-between gap-2 rounded-lg border border-border/60 px-2.5 py-1.5"
                      >
                        <span className="min-w-0 truncate text-xs text-foreground" title={ad.name}>
                          {ad.name}
                        </span>
                        <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                          {fmtSpend(ad.spend, currency)} · CTR {fmtPercent(ad.ctr)} · {ad.conversions} conv.
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* padrões identificados */}
              {data.patterns && (
                <div>
                  <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Por que performam
                  </p>
                  <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground/90">
                    {data.patterns}
                  </p>
                </div>
              )}

              {/* variações de copy prontas */}
              {data.variations && data.variations.length > 0 && (
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    Variações sugeridas
                  </p>
                  <div className="flex flex-col gap-2">
                    {data.variations.map((v, i) => (
                      <div key={i} className="rounded-lg border border-border/60 p-2.5">
                        <p className="mb-1 text-[10px] text-muted-foreground">
                          Baseado em: <span className="text-foreground/80">{v.basedOn}</span>
                        </p>
                        <ul className="flex flex-col gap-1">
                          {v.copies.map((c, j) => (
                            <li key={j} className="flex items-start justify-between gap-2">
                              <span className="text-xs leading-relaxed text-foreground/90">{c}</span>
                              <button
                                type="button"
                                onClick={() => navigator.clipboard?.writeText(c).catch(() => {})}
                                className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                                title="Copiar"
                              >
                                copiar
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {data.cached && (
                <p className="text-[10px] text-muted-foreground">
                  Análise em cache (renova a cada 24h){data.stale ? ' — desatualizada, clique em Reanalisar' : ''}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </GlassCard>
  )
}
