'use client'

import { useState, useEffect } from 'react'
import {
  User, LogOut, Loader2, Check, KeyRound, Copy, Trash2, SlidersHorizontal, Coins,
  DownloadCloud, UploadCloud, Info, ShieldCheck, Download,
} from 'lucide-react'
import useSWR from 'swr'
import { useAccount, useHealth, apiSend, fetcher } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { usePrefs } from '@/lib/prefs'
import { GlassCard } from '@/components/glass-card'
import { Modal } from '@/components/ui/modal'
import { SecurityCard, AccountPrefsCard } from '@/components/config/account-security'
import { WebPushCard } from '@/components/config/web-push-card'
import { Switch } from '@/components/ui/switch'

export function ConfigView() {
  return (
    <div className="flex flex-col gap-6">
      <AccountCard />
      <SecurityCard />
      <CurrencyCard />
      <AccountPrefsCard />
      <PreferencesCard />
      <WebPushCard />
      <AuditCard />
      <DangerCard />
    </div>
  )
}

/* Itens 417/439: trilha de auditoria — ações sensíveis da conta com IP mascarado */
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
          <div className="flex size-10 items-center justify-center rounded-full bg-secondary">
             <ShieldCheck className="size-4 text-[color:var(--brand-cyan)]" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Trilha de Auditoria</h2>
            <p className="text-xs text-muted-foreground">Logins, edições e atividades da conta</p>
          </div>
        </div>
        <span className="text-xs font-semibold text-muted-foreground border border-border px-3 py-1.5 rounded-lg">
          Ver registro
        </span>
      </GlassCard>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Atividade da Conta" description="Ações sensíveis registradas (logins, links, resets) com IP mascarado" maxWidth="max-w-xl">
        {!data ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Carregando…</p>
        ) : !data.enabled ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Trilha indisponível: banco de dados não configurado.
          </p>
        ) : data.log.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            Nenhuma atividade registrada ainda. Logins e alterações aparecem aqui.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40 border-t border-border pt-1 max-h-[60vh] overflow-y-auto pr-2">
            {data.log.map((r) => (
              <li key={r.id} className="flex items-baseline gap-3 py-3 text-xs">
                <span className="shrink-0 font-medium text-foreground">
                  {AUDIT_LABELS[r.action] || r.action}
                </span>
                {r.detail ? <span className="truncate text-muted-foreground">{r.detail}</span> : null}
                <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
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





// Moedas mais comuns no público do app (LATAM + principais globais)
const CURRENCIES: { code: string; label: string }[] = [
  { code: 'BRL', label: 'Real brasileiro (R$)' },
  { code: 'USD', label: 'Dólar americano (US$)' },
  { code: 'EUR', label: 'Euro (€)' },
  { code: 'GBP', label: 'Libra esterlina (£)' },
  { code: 'MXN', label: 'Peso mexicano (MX$)' },
  { code: 'ARS', label: 'Peso argentino (AR$)' },
  { code: 'COP', label: 'Peso colombiano (CO$)' },
  { code: 'CLP', label: 'Peso chileno (CL$)' },
  { code: 'PEN', label: 'Sol peruano (S/)' },
]

/** Item 30: moeda padrão da conta — alimenta disparos e testes da Events API */
function CurrencyCard() {
  const { data, mutate } = useSWR<{ defaultCurrency: string }>('/api/settings', fetcher, {
    revalidateOnFocus: false,
  })
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChange(code: string) {
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      await apiSend('/api/settings', 'POST', { defaultCurrency: code })
      await mutate()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar moeda')
    } finally {
      setSaving(false)
    }
  }

  const current = data?.defaultCurrency ?? 'BRL'

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <Coins className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Moeda da conta</h2>
          <p className="text-xs text-muted-foreground">
            Usada nos eventos enviados ao TikTok quando o gateway não informa a moeda
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
        <select
          value={current}
          onChange={(e) => handleChange(e.target.value)}
          disabled={saving || !data}
          aria-label="Moeda padrão da conta"
          className="rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
        >
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.label}
            </option>
          ))}
        </select>
        {saving && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Salvando" />}
        {saved && (
          <span className="flex items-center gap-1 text-xs text-success" role="status">
            <Check className="size-3.5" /> Moeda salva
          </span>
        )}
        {error && (
          <span className="text-xs text-destructive" role="alert">
            {error}
          </span>
        )}
      </div>
    </GlassCard>
  )
}

/** Bloco S (itens 121/122/125): preferências visuais persistidas em localStorage */
function PreferencesCard() {
  const { prefs, update } = usePrefs()

  const OPTIONS: {
    key: 'density' | 'anim' | 'privacy'
    label: string
    hint: string
    on: string
    off: string
    isOn: boolean
    toggle: () => void
  }[] = [
    {
      key: 'density',
      label: 'Modo compacto',
      hint: 'Reduz espaçamentos de cards e tabelas em ~25%',
      on: 'compact',
      off: 'comfortable',
      isOn: prefs.density === 'compact',
      toggle: () => update({ density: prefs.density === 'compact' ? 'comfortable' : 'compact' }),
    },
    {
      key: 'anim',
      label: 'Reduzir animações',
      hint: 'Desliga transições e efeitos de movimento',
      on: 'off',
      off: 'on',
      isOn: prefs.anim === 'off',
      toggle: () => update({ anim: prefs.anim === 'off' ? 'on' : 'off' }),
    },
    {
      key: 'privacy',
      label: 'Modo apresentação',
      hint: 'Borra receita e valores sensíveis para gravar tela',
      on: 'on',
      off: 'off',
      isOn: prefs.privacy === 'on',
      toggle: () => update({ privacy: prefs.privacy === 'on' ? 'off' : 'on' }),
    },
  ]

  return (
    <GlassCard className="p-5">
      <div className="mb-3 flex items-center gap-2.5">
        <SlidersHorizontal className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Aparência</h2>
          <p className="text-xs text-muted-foreground">
            Preferências visuais salvas neste navegador
          </p>
        </div>
      </div>
      <div className="flex flex-col gap-1 border-t border-border pt-3">
        {OPTIONS.map((opt) => (
          <label key={opt.key} className="flex cursor-pointer items-center justify-between gap-3 py-1">
            <span>
              <span className="block text-sm text-foreground">{opt.label}</span>
              <span className="block text-xs text-muted-foreground">{opt.hint}</span>
            </span>
            <Switch checked={opt.isOn} onChange={opt.toggle} label={opt.label} />
          </label>
        ))}
      </div>
    </GlassCard>
  )
}



/* Item 428: contagens da zona de perigo (o que será apagado) */
interface DataCounts {
  leads?: number
  events?: number
  events_arquivados?: number
  links?: number
  pixels?: number
  gateways?: number
  dominios?: number
}

function DangerCard() {
  const [confirming, setConfirming] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [done, setDone] = useState(false)

  /* Item 428: pré-visualização do que existe hoje na conta */
  const { data: countsData } = useSWR<{ ok: boolean; counts: DataCounts }>('/api/account/data-counts', fetcher, {
    revalidateOnFocus: false,
  })
  const counts = countsData?.counts

  /* Item 427: modal de exclusão da conta com confirmação forte */
  const [delOpen, setDelOpen] = useState(false)
  const [delPw, setDelPw] = useState('')
  const [delPhrase, setDelPhrase] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [delError, setDelError] = useState<string | null>(null)
  const delReady = delPw.length > 0 && delPhrase === 'EXCLUIR MINHA CONTA'

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

  async function handleDelete() {
    if (!delReady) return
    setDeleting(true)
    setDelError(null)
    try {
      await apiSend('/api/account/delete', 'POST', { password: delPw, confirm: delPhrase })
      // Conta apagada — sessão morreu junto; volta para o login do Express
      window.location.href = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'
    } catch (e) {
      setDelError(e instanceof Error ? e.message : 'Erro ao excluir a conta')
      setDeleting(false)
    }
  }

  return (
    /* Item 82: zona de perigo demarcada — hairline rosa + fundo rosa 3% */
    <GlassCard className="danger-zone p-5">
      {/* Item 426 (LGPD): exportação completa dos dados da conta */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-2.5">
          <Download className="size-4 text-[color:var(--brand-cyan)]" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Exportar todos os dados (LGPD)</h2>
            <p className="text-xs text-muted-foreground">
              JSON com perfil, links, pixels, leads, eventos e auditoria — sem chaves secretas
            </p>
          </div>
        </div>
        <a
          href="/api/account/export"
          download
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary"
        >
          <Download className="size-3.5" />
          Baixar meus dados
        </a>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border py-4">
        <div className="flex items-center gap-2.5">
          <Trash2 className="size-4 text-destructive" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Zerar estatísticas</h2>
            <p className="text-xs text-muted-foreground">
              Apaga leads, eventos e séries da sua conta. Links, pixels e domínios são mantidos.
            </p>
            {/* Item 428: o que será apagado */}
            {counts && (
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Hoje: {counts.leads ?? 0} lead(s), {counts.events ?? 0} evento(s)
                {counts.events_arquivados ? ` (+${counts.events_arquivados} arquivados)` : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {confirming && (
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary"
            >
              Cancelar
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
              <Check className="size-3.5" />
            ) : null}
            {done ? 'Zerado' : confirming ? 'Confirmar — apagar tudo' : 'Zerar estatísticas'}
          </button>
        </div>
      </div>

      {/* Item 427: exclusão permanente da conta */}
      <div className="flex flex-wrap items-center justify-between gap-4 pt-4">
        <div className="flex items-center gap-2.5">
          <Trash2 className="size-4 text-destructive" />
          <div>
            <h2 className="section-head text-sm font-semibold text-foreground">Excluir a conta permanentemente</h2>
            <p className="text-xs text-muted-foreground">
              Apaga TUDO — conta, links, pixels, gateways, domínios, leads e eventos. Sem volta.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setDelOpen(true); setDelPw(''); setDelPhrase(''); setDelError(null) }}
          className="rounded-lg border border-destructive/50 px-3 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10"
        >
          Excluir conta
        </button>
      </div>

      {/* Modal de confirmação forte (item 427) */}
      {delOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="presentation"
          onClick={(e) => { if (e.target === e.currentTarget && !deleting) setDelOpen(false) }}
        >
          <div
            className="w-full max-w-md rounded-xl border border-destructive/40 bg-card p-5 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="del-title"
          >
            <h3 id="del-title" className="text-sm font-semibold text-destructive">
              Excluir a conta — sem volta
            </h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {counts
                ? `Será apagado: ${counts.leads ?? 0} lead(s), ${counts.events ?? 0} evento(s), ${counts.links ?? 0} link(s), ${counts.pixels ?? 0} pixel(s), ${counts.gateways ?? 0} gateway(s), ${counts.dominios ?? 0} domínio(s) e toda a configuração. Não há como desfazer.`
                : 'Todos os dados da conta serão apagados permanentemente. Não há como desfazer.'}
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="del-pw">
                Sua senha
              </label>
              <input
                id="del-pw"
                type="password"
                autoComplete="current-password"
                className="input-neon w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground focus:border-destructive focus:outline-none"
                value={delPw}
                onChange={(e) => setDelPw(e.target.value)}
              />
            </div>
            <div className="mt-3">
              <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="del-phrase">
                Digite <b className="text-foreground">EXCLUIR MINHA CONTA</b> para confirmar
              </label>
              <input
                id="del-phrase"
                autoComplete="off"
                className="input-neon w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground focus:border-destructive focus:outline-none"
                value={delPhrase}
                onChange={(e) => setDelPhrase(e.target.value)}
              />
            </div>
            {delError && (
              <p className="anim-shake mt-2 text-xs text-destructive" role="alert">{delError}</p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDelOpen(false)}
                disabled={deleting}
                className="rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!delReady || deleting}
                className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-40"
              >
                {deleting ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Excluir permanentemente
              </button>
            </div>
          </div>
        </div>
      )}
    </GlassCard>
  )
}

function AccountCard() {
  const { data: account } = useAccount()
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await fetch('/logout', { method: 'POST', credentials: 'include' })
      // Login mora no Express (outro host em produção) — redirect completo
      window.location.href = process.env.NEXT_PUBLIC_LOGIN_URL || 'http://localhost:3000/login'
    } catch {
      setLoggingOut(false)
    }
  }

  return (
    <GlassCard className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl"
            style={{ background: 'color-mix(in oklab, var(--brand-cyan) 14%, transparent)' }}
          >
            <User className="size-5 text-[color:var(--brand-cyan)]" />
          </span>
          <div>
            <p className="text-sm font-semibold text-foreground">{account?.name || account?.email || '—'}</p>
            <p className="text-xs text-muted-foreground">
              {account?.email}
              {account?.role ? ` · ${account.role}` : ''}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
        >
          {loggingOut ? <Loader2 className="size-3.5 animate-spin" /> : <LogOut className="size-3.5" />}
          Sair
        </button>
      </div>
    </GlassCard>
  )
}
