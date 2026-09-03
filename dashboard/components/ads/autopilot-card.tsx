'use client'

import { useState } from 'react'
import { Rocket, Sparkles, CheckCircle2, Loader2, Target, TrendingUp } from 'lucide-react'

export function AutopilotCard() {
  const [cloning, setCloning] = useState(false)
  const [success, setSuccess] = useState(false)

  async function handleClone() {
    setCloning(true)
    // Simula integração Smart+ (como pedido: "Simula integração com TikTok Ads via API Smart+")
    await new Promise((r) => setTimeout(r, 3000))
    setCloning(false)
    setSuccess(true)
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border border-brand-cyan/30 bg-secondary/20 p-5 shadow-[0_0_20px_rgba(37,244,238,0.05)] transition-all hover:border-brand-cyan/50 hover:shadow-[0_0_30px_rgba(37,244,238,0.1)]">
      {/* Background glow and sparkles */}
      <div className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-brand-cyan/10 blur-3xl" />
      <Sparkles className="absolute right-4 top-4 size-16 text-brand-cyan/5 opacity-50" />

      <div className="relative z-10 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-brand-cyan/20 to-brand-cyan/5 text-brand-cyan shadow-inner">
            <Rocket className="size-6 drop-shadow-[0_0_8px_rgba(37,244,238,0.8)]" />
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold text-foreground">Campanha Black Friday está com ROI 3.2!</h3>
              <span className="flex items-center gap-1 rounded-full bg-success/20 px-2 py-0.5 text-[10px] font-bold text-success border border-success/30">
                <TrendingUp className="size-3" /> Campeã
              </span>
            </div>
            <p className="text-xs text-muted-foreground text-balance">
              O Autopilot identificou uma oportunidade de escala. Quer clonar a estrutura completa para uma nova campanha Smart+ com mais orçamento?
            </p>
          </div>
        </div>

        {success ? (
          <div className="flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-5 py-2.5 text-sm font-bold text-success shadow-[0_0_15px_rgba(34,197,94,0.2)] animate-in zoom-in shrink-0">
            <CheckCircle2 className="size-4" /> Campanha Criada em Autopilot
          </div>
        ) : (
          <button
            type="button"
            onClick={handleClone}
            disabled={cloning}
            className="group relative flex shrink-0 items-center gap-2 overflow-hidden rounded-full bg-brand-cyan px-5 py-2.5 text-sm font-bold text-black shadow-[0_0_15px_rgba(37,244,238,0.4)] transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-80"
          >
            {cloning ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Clonando Estrutura...
              </>
            ) : (
              <>
                <Target className="size-4 transition-transform group-hover:scale-110" /> Clonar Estrutura e Escalar
              </>
            )}
          </button>
        )}
      </div>
    </div>
  )
}
