'use client'

import { useEffect, useState } from 'react'
import {
  Code, Loader2, Sparkles, Wand2, Terminal, Fingerprint, Lock, ShieldCheck, Download, Trash2, Coins, SlidersHorizontal, MessageCircle
} from 'lucide-react'
import useSWR from 'swr'
import { fetcher } from '@/lib/api'
import { GlassCard } from '@/components/glass-card'

// Imports originais
import { SecurityCard, AccountPrefsCard } from '@/components/config/account-security'
import { WebPushCard } from '@/components/config/web-push-card'
import { Switch } from '@/components/ui/switch'
import { usePrefs } from '@/lib/prefs'
import { apiSend } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Modal } from '@/components/ui/modal'
import type { AccountSettings } from '@/lib/types'
import { toast } from '@/lib/toast'

export function ConfigView() {
  const [developerMode, setDeveloperMode] = useState(false)
  const { prefs, update } = usePrefs()

  return (
    <div className="flex flex-col gap-6">
      
      {/* HEADER DE CONFIGURAÇÃO (Modo Mágico / Modo Desenvolvedor) */}
      <GlassCard className="relative overflow-hidden p-6 sm:p-8 border-[color:var(--brand-cyan)]/30 shadow-[0_0_40px_rgba(37,244,238,0.05)]">
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-[color:var(--brand-cyan)]/10 blur-[80px]" />
        
        <div className="relative z-10 flex flex-col items-center text-center mb-6">
          <div className="flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-[color:var(--brand-cyan)]/20 to-[color:var(--brand-cyan)]/5 shadow-inner mb-4">
            {developerMode ? (
              <Terminal className="size-8 text-[color:var(--brand-cyan)] drop-shadow-[0_0_10px_rgba(37,244,238,0.8)]" />
            ) : (
              <Sparkles className="size-8 text-[color:var(--brand-cyan)] drop-shadow-[0_0_10px_rgba(37,244,238,0.8)]" />
            )}
          </div>
          <h2 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-white/70">
            {developerMode ? 'Modo Desenvolvedor Ativo' : 'Configurações Inteligentes'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg text-balance">
            {developerMode 
              ? 'Acesso total aos parâmetros, logs de auditoria, integrações brutas de API e controles destrutivos.' 
              : 'Nós otimizamos e conectamos sua plataforma por debaixo dos panos. Altere apenas preferências visuais essenciais.'}
          </p>
        </div>

        <div className="mx-auto max-w-sm flex items-center justify-center p-1 rounded-xl bg-secondary/30 border border-border">
          <button
            className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 ${!developerMode ? 'bg-[color:var(--brand-cyan)] text-black shadow-[0_0_15px_rgba(37,244,238,0.4)] scale-[1.02]' : 'text-muted-foreground hover:bg-white/5'}`}
            onClick={() => setDeveloperMode(false)}
          >
            <Wand2 className="size-4" />
            Modo Mágico
          </button>
          <button
            className={`flex-1 rounded-lg py-2.5 text-xs font-bold transition-all flex items-center justify-center gap-2 ${developerMode ? 'bg-secondary text-foreground shadow-md' : 'text-muted-foreground hover:bg-white/5'}`}
            onClick={() => setDeveloperMode(true)}
          >
            <Code className="size-4" />
            Avançado
          </button>
        </div>
      </GlassCard>

      {/* ── MODO MÁGICO (Configurações Silenciosas) ── */}
      {!developerMode && (
        <div className="flex flex-col gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <GlassCard className="p-5">
            <div className="mb-4 flex items-center gap-2.5">
              <SlidersHorizontal className="size-5 text-[color:var(--brand-cyan)]" />
              <div>
                <h2 className="text-sm font-bold text-foreground">Experiência da Plataforma</h2>
                <p className="text-xs text-muted-foreground">Sua interface adaptada ao seu estilo.</p>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className="flex cursor-pointer items-center justify-between gap-3 py-2 rounded-lg hover:bg-secondary/20 px-3 transition-colors">
                <span>
                  <span className="block text-sm font-semibold text-foreground">Reduzir Animações</span>
                  <span className="block text-xs text-muted-foreground">Desliga transições e efeitos de movimento</span>
                </span>
                <Switch checked={prefs.anim === 'off'} onChange={() => update({ anim: prefs.anim === 'off' ? 'on' : 'off' })} label="Reduzir animações" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3 py-2 rounded-lg hover:bg-secondary/20 px-3 transition-colors">
                <span>
                  <span className="block text-sm font-semibold text-foreground">Modo Apresentação / Privacidade</span>
                  <span className="block text-xs text-muted-foreground">Borra receitas e valores sensíveis (ideal para gravar vídeos)</span>
                </span>
                <Switch checked={prefs.privacy === 'on'} onChange={() => update({ privacy: prefs.privacy === 'on' ? 'off' : 'on' })} label="Modo apresentação" />
              </label>
            </div>
          </GlassCard>

          <DailyReportCard />

          <GlassCard className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-[color:var(--success)]/20 text-[color:var(--success)] shadow-[0_0_15px_rgba(34,197,94,0.3)]">
                <ShieldCheck className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Segurança & Auditoria Inteligente</h2>
                <p className="text-xs text-muted-foreground">Sua conta está protegida e auditada invisivelmente. (Gerencie em Avançado)</p>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-full bg-[color:var(--brand-cyan)]/20 text-[color:var(--brand-cyan)] shadow-[0_0_15px_rgba(37,244,238,0.3)]">
                <Coins className="size-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-foreground">Sincronização de Vendas Ativa</h2>
                <p className="text-xs text-muted-foreground">CAPI e Webhooks processando conversões silenciosamente. (Ver logs em Avançado)</p>
              </div>
            </div>
          </GlassCard>
        </div>
      )}

      {/* ── MODO DESENVOLVEDOR (Tudo visível) ── */}
      {developerMode && (
        <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <SecurityCard />
          <AccountPrefsCard />
          <WebPushCard />
          <AuditCard />
          <DangerCard />
        </div>
      )}
    </div>
  )
}

// ── COMPONENTES AUXILIARES PRESERVADOS ──

const AUDIT_LABELS: Record<string, string> = {
  login: 'Login no painel',
  reset_stats: 'Estatísticas zeradas',
  link_salvo: 'Link salvo',
  link_removido: 'Link removido',
  backup_importado: 'Backup importado',
}

interface AuditRow {
  id: string
  at: string
  action: string
  detail: string | null
  ip: string | null
}

function AuditCard() {
  const [open, setOpen] = useState(false)
  const { data } = useSWR<{ ok: boolean; enabled: boolean; log: AuditRow[] }>(
    '/api/audit?limit=30',
    fetcher,
    { revalidateOnFocus: false },
  )

  return (
    <>
      <GlassCard 
        className="p-5 flex items-center justify-between cursor-pointer transition-colors hover:bg-secondary/40" 
        onClick={() => setOpen(true)}
        role="button"
        tabIndex={0}
      >
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary border border-border">
             <Fingerprint className="size-4 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Trilha de Auditoria (Logs API)</h2>
            <p className="text-xs text-muted-foreground">Eventos de sistema com resolução de IP</p>
          </div>
        </div>
        <span className="text-xs font-mono font-semibold text-muted-foreground border border-border bg-black/50 px-3 py-1.5 rounded-lg">
          GET /api/audit
        </span>
      </GlassCard>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Audit Logs" description="Eventos de auditoria brutos" maxWidth="max-w-xl">
        {!data ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Fetching...</p>
        ) : data.log.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Nenhuma atividade registrada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40 border-t border-border pt-1 max-h-[60vh] overflow-y-auto pr-2">
            {data.log.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 py-3 text-xs font-mono">
                <span className="shrink-0 font-bold text-foreground">
                  [{r.action.toUpperCase()}]
                </span>
                {r.detail ? <span className="truncate text-muted-foreground">{r.detail}</span> : null}
                <span className="ml-auto flex shrink-0 items-center gap-2 text-[10px] text-muted-foreground/50">
                  {r.ip ? <span>{r.ip}</span> : null}
                  <span>{formatDateTime(r.at)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </>
  )
}

function DailyReportCard() {
  const { data, mutate } = useSWR<AccountSettings>('/api/settings', fetcher, { revalidateOnFocus: false })
  const [phone, setPhone] = useState('')
  const [hour, setHour] = useState(8)
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState(true)
  useEffect(() => { setFeedback(localStorage.getItem('roi_action_feedback') !== 'off') }, [])
  useEffect(() => {
    if (!data) return
    setPhone(data.whatsappTo || '')
    setHour(data.dailyReportHour ?? 8)
    setEnabled(data.dailyReportEnabled === true)
  }, [data])
  async function save() {
    setSaving(true)
    try {
      await apiSend('/api/settings', 'POST', { dailyReportEnabled: enabled, dailyReportHour: hour, whatsappTo: phone })
      toast.success('Relatório diário configurado')
      await mutate()
    } catch (error) { toast.error('Falha ao salvar', { hint: error instanceof Error ? error.message : undefined }) }
    finally { setSaving(false) }
  }
  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-start justify-between gap-3"><div className="flex gap-3"><div className="flex size-10 items-center justify-center rounded-full bg-success/15 text-success"><MessageCircle className="size-5" /></div><div><h2 className="text-sm font-bold text-foreground">Resumo das 8h no celular</h2><p className="text-xs text-muted-foreground">Gasto, vendas, ROAS e lucro por Pushcut, Web Push e WhatsApp.</p></div></div><Switch checked={enabled} onChange={setEnabled} label="Ativar relatório diário" /></div>
      <div className="grid gap-3 sm:grid-cols-[1fr_100px_auto]">
        <label className="text-[11px] text-muted-foreground">WhatsApp com DDI<input className="input mt-1 w-full" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} placeholder="5511999999999" /></label>
        <label className="text-[11px] text-muted-foreground">Hora<input className="input mt-1 w-full" type="number" min="0" max="23" value={hour} onChange={(event) => setHour(Number(event.target.value))} /></label>
        <button type="button" className="btn-primary self-end text-xs" onClick={save} disabled={saving}>{saving ? <Loader2 className="size-3 animate-spin" /> : null} Salvar</button>
      </div>
      <label className="mt-4 flex items-center justify-between rounded-lg border border-border/50 px-3 py-2 text-xs"><span><b className="block text-foreground">Som e vibração nas ações</b><small className="text-muted-foreground">Feedback sutil ao salvar orçamentos e campanhas.</small></span><Switch checked={feedback} onChange={(next) => { setFeedback(next); localStorage.setItem('roi_action_feedback', next ? 'on' : 'off') }} label="Feedback sonoro e tátil" /></label>
      {data?.whatsapp && !data.whatsapp.configured && <p className="mt-3 text-[10px] text-warning">WhatsApp ainda requer as credenciais Cloud API no servidor. Pushcut e Web Push continuam disponíveis.</p>}
      {data?.whatsapp?.configured && !data.whatsapp.templateConfigured && <p className="mt-3 text-[10px] text-warning">Configure WHATSAPP_DAILY_TEMPLATE aprovado pela Meta para envios proativos fora da janela de atendimento.</p>}
    </GlassCard>
  )
}

function DangerCard() {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [done, setDone] = useState(false)

  async function handleReset() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    setResetting(true)
    try {
      await apiSend('/api/reset-stats', 'POST', {})
      setDone(true)
      setTimeout(() => setDone(false), 3000)
    } finally {
      setResetting(false)
      setConfirming(false)
    }
  }

  return (
    <GlassCard className="danger-zone p-5 border-destructive/20 bg-destructive/5">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-destructive/20 pb-4">
        <div className="flex items-center gap-2.5">
          <Download className="size-4 text-[color:var(--brand-cyan)]" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Dump de Dados (JSON)</h2>
            <p className="text-xs text-muted-foreground">
              Exportação via API de schema completo
            </p>
          </div>
        </div>
        <a
          href="/api/account/export"
          download
          className="flex items-center gap-1.5 rounded-lg border border-border bg-black/50 px-3 py-2 text-xs font-mono text-foreground transition-colors hover:bg-secondary"
        >
          <Download className="size-3.5" /> GET /export
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
        <div className="flex items-center gap-2.5">
          <Trash2 className="size-4 text-destructive" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">TRUNCATE Data (Estatísticas)</h2>
            <p className="text-xs text-muted-foreground">
              Deleta todos os leads e eventos do banco. Ação irreversível.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={handleReset}
            disabled={resetting}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50 ${
              confirming
                ? 'bg-destructive text-white hover:opacity-90'
                : 'border border-destructive/50 text-destructive hover:bg-destructive/10'
            }`}
          >
            {resetting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : done ? (
              <ShieldCheck className="size-3.5" />
            ) : null}
            {done ? 'Executed' : confirming ? 'Ação Crítica. Confirmar TRUNCATE' : 'TRUNCATE Estatísticas'}
          </button>
        </div>
      </div>
    </GlassCard>
  )
}
