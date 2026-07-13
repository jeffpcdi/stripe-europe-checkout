'use client'

// Alertas de performance do TikTok Ads. Duas regras simples e objetivas:
//  • gasto sem conversão: campanha ativa gastou ≥ X no período sem converter
//  • CPA estourado: gasto/conversões acima do teto
// O servidor varre a cada 30min (pegando carona no polling do painel) e
// notifica via Pushcut. Aqui o usuário configura e pode "verificar agora".

import { useEffect, useState } from 'react'
import { BellRing, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react'
import { useAdsAlerts, apiSend } from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsAlertsConfig, AdsAlertCheckResponse } from '@/lib/types'

export function AlertsDialog({
  open,
  onClose,
  currency,
}: {
  open: boolean
  onClose: () => void
  currency: string
}) {
  const { data: saved, mutate } = useAdsAlerts(open)

  const [enabled, setEnabled] = useState(false)
  const [spendNoConv, setSpendNoConv] = useState('20')
  const [cpaMax, setCpaMax] = useState('0')
  const [lookbackDays, setLookbackDays] = useState('2')
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [findings, setFindings] = useState<AdsAlertCheckResponse | null>(null)

  // Sincroniza o formulário quando a config salva chega/muda
  useEffect(() => {
    if (!saved) return
    setEnabled(saved.enabled)
    setSpendNoConv(String(saved.spendNoConv))
    setCpaMax(String(saved.cpaMax))
    setLookbackDays(String(saved.lookbackDays))
  }, [saved])

  useEffect(() => {
    if (!open) setFindings(null)
  }, [open])

  if (!open) return null

  async function handleSave() {
    setSaving(true)
    try {
      await apiSend<AdsAlertsConfig>('/api/ads/alerts', 'PUT', {
        enabled,
        spendNoConv: Number(spendNoConv.replace(',', '.')) || 0,
        cpaMax: Number(cpaMax.replace(',', '.')) || 0,
        lookbackDays: parseInt(lookbackDays, 10) || 2,
      })
      toast.success(enabled ? 'Alertas ativados' : 'Alertas salvos (desativados)')
      mutate()
      onClose()
    } catch (e) {
      toast.error('Falha ao salvar alertas', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setSaving(false)
    }
  }

  async function handleCheckNow() {
    setChecking(true)
    setFindings(null)
    try {
      // salva antes para a varredura usar os valores em tela
      await apiSend<AdsAlertsConfig>('/api/ads/alerts', 'PUT', {
        enabled,
        spendNoConv: Number(spendNoConv.replace(',', '.')) || 0,
        cpaMax: Number(cpaMax.replace(',', '.')) || 0,
        lookbackDays: parseInt(lookbackDays, 10) || 2,
      })
      mutate()
      const r = await apiSend<AdsAlertCheckResponse>('/api/ads/alerts/check', 'POST')
      setFindings(r)
      if (!r.findings?.length) toast.success('Tudo certo', { hint: 'Nenhuma campanha disparou as regras.' })
    } catch (e) {
      toast.error('Falha ao verificar', { hint: e instanceof Error ? e.message : undefined })
    } finally {
      setChecking(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ads-alerts-title"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        aria-label="Fechar"
        tabIndex={-1}
      />
      <div className="anim-pop-in relative w-full max-w-md rounded-2xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
            <BellRing className="size-4 text-primary" aria-hidden="true" />
          </span>
          <div>
            <h2 id="ads-alerts-title" className="text-sm font-semibold text-foreground">
              Alertas de performance
            </h2>
            <p className="text-[11px] text-muted-foreground">Notificações via Pushcut quando algo foge do padrão</p>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2.5">
            <span className="text-xs font-medium text-foreground">Alertas ativos</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="size-4 accent-[color:var(--primary)]"
              aria-label="Ativar ou desativar alertas"
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Gasto sem conversão <span className="text-muted-foreground">({currency})</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
              value={spendNoConv}
              onChange={(e) => setSpendNoConv(e.target.value)}
              placeholder="20"
            />
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              Avisa quando uma campanha ativa gastar esse valor (ou mais) sem nenhuma conversão. 0 desliga a regra.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">
              Teto de CPA <span className="text-muted-foreground">({currency})</span>
            </span>
            <input
              type="number"
              inputMode="decimal"
              min={0}
              step="1"
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground"
              value={cpaMax}
              onChange={(e) => setCpaMax(e.target.value)}
              placeholder="0"
            />
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              Avisa quando o custo por conversão passar desse teto. 0 desliga a regra.
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-foreground">Janela de análise (dias)</span>
            <select
              className="input-neon w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground"
              value={lookbackDays}
              onChange={(e) => setLookbackDays(e.target.value)}
            >
              <option value="1">Último dia</option>
              <option value="2">Últimos 2 dias</option>
              <option value="3">Últimos 3 dias</option>
              <option value="7">Últimos 7 dias</option>
            </select>
          </label>

          {/* Resultado do "verificar agora" */}
          {findings && (
            <div className="anim-content-in flex flex-col gap-1.5 rounded-xl border border-border bg-secondary/30 p-3">
              {findings.findings.length === 0 ? (
                <span className="flex items-center gap-1.5 text-xs text-[color:var(--success)]">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  Nenhuma campanha disparou as regras.
                </span>
              ) : (
                findings.findings.map((f, i) => (
                  <span key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[color:var(--warning)]" aria-hidden="true" />
                    {f.text}
                    {f.muted && <span className="text-[10px] text-muted-foreground">(já notificado)</span>}
                  </span>
                ))
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          <button type="button" className="btn-ghost text-xs" onClick={handleCheckNow} disabled={checking || saving}>
            {checking ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <ShieldCheck className="size-3.5" aria-hidden="true" />
            )}
            Verificar agora
          </button>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost text-xs" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="button" className="btn-primary text-xs" onClick={handleSave} disabled={saving || checking}>
              {saving && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
