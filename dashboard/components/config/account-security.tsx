'use client'

/**
 * Conta e segurança + preferências avançadas (itens 411/413/414/415 e 419/422–430).
 * Os endpoints moram no Express (mesma origem via proxy /dashboard):
 *  - POST /api/account/name            → item 413 (editar nome)
 *  - POST /api/account/password        → item 411 (trocar senha; derruba outras sessões)
 *  - GET  /api/account/sessions        → item 414 (sessões ativas)
 *  - DELETE /api/account/sessions/:sid → item 414 (encerrar uma)
 *  - POST /api/account/sessions/revoke-others → item 414/415 (encerrar todas as outras)
 *  - GET/POST /api/settings            → itens 422/423/424/425/429/430
 *  - POST /api/settings/webhook-test   → item 424 (teste de disparo)
 */

import { useState } from 'react'
import {
  ShieldCheck, Loader2, Check, MonitorSmartphone, Globe2, Send,
} from 'lucide-react'
import useSWR from 'swr'
import { useAccount, apiSend, fetcher } from '@/lib/api'
import { formatDateTime } from '@/lib/format'
import { Modal } from '@/components/ui/modal'
import { GlassCard } from '@/components/glass-card'

const inputCls =
  'input-neon w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none'
const btnGhost =
  'flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50'
const btnPrimary =
  'flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98] disabled:opacity-50 disabled:shadow-none'

/* ── Item 414: resumo do user-agent ("Chrome · Windows") ────────────────── */
function shortUa(ua: string | null): string {
  if (!ua) return 'Dispositivo desconhecido'
  const u = ua.toLowerCase()
  const browser = u.includes('edg') ? 'Edge' : u.includes('opr') ? 'Opera'
    : u.includes('chrome') ? 'Chrome' : u.includes('firefox') ? 'Firefox'
    : u.includes('safari') ? 'Safari' : 'Navegador'
  const os = u.includes('windows') ? 'Windows' : /iphone|ipad/.test(u) ? 'iOS'
    : u.includes('android') ? 'Android' : u.includes('mac os') ? 'macOS'
    : u.includes('linux') ? 'Linux' : ''
  return os ? `${browser} · ${os}` : browser
}

interface SessionRow {
  sid: string
  current: boolean
  createdAt: string
  expiresAt: string
  ua: string | null
  ip: string | null
}

/* ── Conta e segurança: nome (413), senha (411), sessões (414/415) ──────── */
export function SecurityCard() {
  const { data: account, mutate: mutateAccount } = useAccount()
  const { data: sessions, mutate: mutateSessions } = useSWR<{ ok: boolean; sessions: SessionRow[] }>(
    '/api/account/sessions',
    fetcher,
    { revalidateOnFocus: false },
  )

  const [modalPw, setModalPw] = useState(false)
  const [modalSessions, setModalSessions] = useState(false)
  const [modal2FA, setModal2FA] = useState(false)

  /* item 413 — nome */
  const [name, setName] = useState<string | null>(null)
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const nameValue = name ?? account?.name ?? ''

  async function saveName() {
    setSavingName(true)
    setNameMsg(null)
    try {
      await apiSend('/api/account/name', 'POST', { name: nameValue.trim() })
      await mutateAccount()
      setNameMsg({ ok: true, text: 'Nome salvo' })
    } catch (e) {
      setNameMsg({ ok: false, text: e instanceof Error ? e.message : 'Erro ao salvar' })
    } finally {
      setSavingName(false)
      setTimeout(() => setNameMsg(null), 3000)
    }
  }

  /* item 411 — trocar senha */
  const [pwCur, setPwCur] = useState('')
  const [pwNew, setPwNew] = useState('')
  const [pwNew2, setPwNew2] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function savePassword() {
    setPwMsg(null)
    if (pwNew.length < 8) return setPwMsg({ ok: false, text: 'A nova senha precisa de pelo menos 8 caracteres.' })
    if (pwNew !== pwNew2) return setPwMsg({ ok: false, text: 'A confirmação não confere com a nova senha.' })
    setSavingPw(true)
    try {
      const r = await apiSend<{ ok: boolean; revoked?: number }>('/api/account/password', 'POST', {
        currentPassword: pwCur,
        newPassword: pwNew,
      })
      setPwCur(''); setPwNew(''); setPwNew2('')
      setPwMsg({ ok: true, text: 'Senha alterada' + (r.revoked ? ` — ${r.revoked} outra(s) sessão(ões) encerrada(s)` : '') })
      mutateSessions()
    } catch (e) {
      setPwMsg({ ok: false, text: e instanceof Error ? e.message : 'Erro ao trocar a senha' })
    } finally {
      setSavingPw(false)
    }
  }

  /* item 414 — sessões */
  const [revoking, setRevoking] = useState<string | null>(null)

  async function revokeOne(sid: string) {
    setRevoking(sid)
    try {
      await fetch(`/api/account/sessions/${sid}`, { method: 'DELETE', credentials: 'include' })
      mutateSessions()
    } finally {
      setRevoking(null)
    }
  }
  async function revokeOthers() {
    setRevoking('all')
    try {
      await apiSend('/api/account/sessions/revoke-others', 'POST', {})
      mutateSessions()
    } finally {
      setRevoking(null)
    }
  }

  const list = sessions?.sessions ?? []

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <ShieldCheck className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Conta e segurança</h2>
          <p className="text-xs text-muted-foreground">Nome, senha e sessões ativas desta conta</p>
        </div>
      </div>

      {/* item 413 — nome */}
      <div className="border-t border-border pt-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="acc-name">
          Nome da conta
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="acc-name"
            className={`${inputCls} max-w-xs`}
            value={nameValue}
            maxLength={80}
            autoComplete="name"
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" onClick={saveName} disabled={savingName || !nameValue.trim()} className={btnGhost}>
            {savingName ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Salvar
          </button>
          {nameMsg && (
            <span className={`text-xs ${nameMsg.ok ? 'text-success' : 'anim-shake text-destructive'}`} role="status">
              {nameMsg.text}
            </span>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        <button type="button" onClick={() => setModalPw(true)} className={btnGhost}>
          Trocar senha
        </button>
        <button type="button" onClick={() => setModal2FA(true)} className={btnGhost}>
          Autenticação 2FA
        </button>
        <button type="button" onClick={() => setModalSessions(true)} className={btnGhost}>
          Dispositivos conectados
        </button>
      </div>

      {/* item 411 — trocar senha (MODAL) */}
      <Modal isOpen={modalPw} onClose={() => setModalPw(false)} title="Trocar senha" description="As outras sessões serão encerradas por segurança.">
        <div className="flex flex-col gap-3">
          <input className={`${inputCls}`} type="password" placeholder="Senha atual" autoComplete="current-password" value={pwCur} onChange={(e) => setPwCur(e.target.value)} />
          <input className={`${inputCls}`} type="password" placeholder="Nova senha (mín. 8)" autoComplete="new-password" value={pwNew} onChange={(e) => setPwNew(e.target.value)} />
          <input className={`${inputCls}`} type="password" placeholder="Repita a nova" autoComplete="new-password" value={pwNew2} onChange={(e) => setPwNew2(e.target.value)} />
          <div className="flex items-center justify-end gap-2 mt-2">
             {pwMsg && (
                <p className={`text-xs ${pwMsg.ok ? 'text-success' : 'anim-shake text-destructive'} mr-auto`} role="status">
                  {pwMsg.text}
                </p>
              )}
             <button type="button" onClick={() => setModalPw(false)} className={btnGhost}>
                Cancelar
             </button>
             <button type="button" onClick={savePassword} disabled={savingPw || !pwCur || !pwNew} className={btnPrimary}>
                {savingPw ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Salvar nova senha
             </button>
          </div>
        </div>
      </Modal>

      {/* item 420 — verificação em duas etapas (TOTP) (MODAL) */}
      <Modal isOpen={modal2FA} onClose={() => setModal2FA(false)} title="Autenticação em Duas Etapas (2FA)">
        <TwofaSection />
      </Modal>

      {/* item 414 — sessões ativas (MODAL) */}
      <Modal isOpen={modalSessions} onClose={() => setModalSessions(false)} title="Sessões Ativas" description="Onde sua conta está logada agora">
        <div className="flex items-center justify-end mb-4">
          <button
            type="button"
            onClick={revokeOthers}
            disabled={revoking !== null || list.filter((s) => !s.current).length === 0}
            className={btnGhost}
          >
            {revoking === 'all' ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Encerrar todas as outras
          </button>
        </div>
        {!sessions ? (
          <p className="py-2 text-xs text-muted-foreground">Carregando sessões…</p>
        ) : list.length === 0 ? (
          <p className="py-2 text-xs text-muted-foreground">Nenhuma sessão ativa encontrada.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/40">
            {list.map((s) => (
              <li key={s.sid} className="flex items-center gap-3 py-3">
                <MonitorSmartphone className="size-5 shrink-0 text-[color:var(--brand-cyan)]" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">
                    {shortUa(s.ua)}
                    {s.current && (
                      <span className="ml-2 rounded-full bg-[color:var(--brand-cyan)]/15 px-2 py-0.5 text-[10px] font-semibold text-[color:var(--brand-cyan)]">
                        esta sessão
                      </span>
                    )}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    entrou em {formatDateTime(s.createdAt)}
                    {s.ip ? ` · IP ${s.ip}` : ''}
                  </p>
                </div>
                {!s.current && (
                  <button
                    type="button"
                    onClick={() => revokeOne(s.sid)}
                    disabled={revoking !== null}
                    className="shrink-0 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                  >
                    {revoking === s.sid ? <Loader2 className="size-3 animate-spin" /> : 'Encerrar'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </GlassCard>
  )
}

/* ── Item 420: verificação em duas etapas (TOTP) ─────────────────────────
 * Fluxo: POST /api/account/2fa/setup → QR + secret (nada persiste) →
 * POST /api/account/2fa/confirm com o código do app → ativo.
 * Desativar exige um código válido (POST /api/account/2fa/disable). */
function TwofaSection() {
  const { data: status, mutate } = useSWR<{ ok: boolean; enabled: boolean }>('/api/account/2fa', fetcher, {
    revalidateOnFocus: false,
  })
  const [setup, setSetup] = useState<{ secret: string; qr: string | null } | null>(null)
  const [code, setCode] = useState('')
  const [disableCode, setDisableCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function flash(ok: boolean, text: string) {
    setMsg({ ok, text })
    setTimeout(() => setMsg(null), 4000)
  }

  async function startSetup() {
    setBusy(true)
    try {
      const r = await apiSend<{ ok: boolean; secret: string; qr: string | null }>('/api/account/2fa/setup', 'POST', {})
      setSetup({ secret: r.secret, qr: r.qr })
      setCode('')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : 'Erro ao gerar o QR')
    } finally {
      setBusy(false)
    }
  }

  async function confirm() {
    if (code.trim().length !== 6) return flash(false, 'Digite os 6 dígitos do app')
    setBusy(true)
    try {
      await apiSend('/api/account/2fa/confirm', 'POST', { code: code.trim() })
      setSetup(null)
      await mutate()
      flash(true, '2FA ativado — o próximo login pedirá o código')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : 'Código incorreto')
    } finally {
      setBusy(false)
    }
  }

  async function disable() {
    if (disableCode.trim().length !== 6) return flash(false, 'Digite o código atual do app')
    setBusy(true)
    try {
      await apiSend('/api/account/2fa/disable', 'POST', { code: disableCode.trim() })
      setDisableCode('')
      await mutate()
      flash(true, '2FA desativado')
    } catch (e) {
      flash(false, e instanceof Error ? e.message : 'Código incorreto')
    } finally {
      setBusy(false)
    }
  }

  const enabled = status?.enabled ?? false

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-border pb-4">
        <p className="text-xs text-muted-foreground">
          Use um aplicativo autenticador no login
        </p>
        <span className={`text-xs font-semibold px-2 py-1 rounded-md ${!status ? 'text-muted-foreground' : enabled ? 'bg-success/10 text-success' : 'bg-secondary text-muted-foreground'}`}>
          {!status ? 'Verificando…' : enabled ? 'Ativo' : 'Desligado'}
        </span>
      </div>

      {status && !enabled && !setup && (
        <button type="button" onClick={startSetup} disabled={busy} className={btnGhost}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
          Ativar 2FA
        </button>
      )}

      {setup && (
        <div className="rounded-lg border border-border p-3">
          <p className="mb-2 text-xs text-muted-foreground">
            1. Escaneie o QR no Google Authenticator, 1Password ou similar (ou digite o código manual). 2. Informe o
            código de 6 dígitos para confirmar.
          </p>
          <div className="flex flex-wrap items-start gap-4">
            {setup.qr && (
              <img src={setup.qr || "/placeholder.svg"} alt="QR code do 2FA" width={150} height={150} className="rounded-lg bg-white" />
            )}
            <div className="min-w-48 flex-1">
              <p className="text-[11px] text-muted-foreground">Código manual</p>
              <code className="mb-2 mt-1 block break-all font-mono text-xs text-foreground">{setup.secret}</code>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className={`${inputCls} max-w-28 text-center tracking-[4px]`}
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="000000"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
                <button type="button" onClick={confirm} disabled={busy || code.length !== 6} className={btnPrimary}>
                  {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                  Confirmar
                </button>
                <button type="button" onClick={() => setSetup(null)} disabled={busy} className={btnGhost}>
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {status && enabled && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            className={`${inputCls} max-w-32 text-center`}
            inputMode="numeric"
            maxLength={6}
            placeholder="Código atual"
            autoComplete="one-time-code"
            value={disableCode}
            onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ''))}
          />
          <button
            type="button"
            onClick={disable}
            disabled={busy || disableCode.length !== 6}
            className="flex items-center gap-1.5 rounded-lg border border-destructive/50 px-3 py-2 text-xs font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Desativar 2FA
          </button>
        </div>
      )}

      {msg && (
        <p className={`mt-2 text-xs ${msg.ok ? 'text-success' : 'anim-shake text-destructive'}`} role="status">
          {msg.text}
        </p>
      )}
    </div>
  )
}

/* ── Preferências avançadas (itens 422/423/424/425/429/430) ─────────────── */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Sao_Paulo', label: 'Brasília (America/Sao_Paulo)' },
  { value: 'America/Manaus', label: 'Manaus (America/Manaus)' },
  { value: 'America/Rio_Branco', label: 'Rio Branco (America/Rio_Branco)' },
  { value: 'America/Noronha', label: 'Noronha (America/Noronha)' },
  { value: 'America/New_York', label: 'Nova York (America/New_York)' },
  { value: 'America/Los_Angeles', label: 'Los Angeles (America/Los_Angeles)' },
  { value: 'Europe/Lisbon', label: 'Lisboa (Europe/Lisbon)' },
  { value: 'Europe/Madrid', label: 'Madri (Europe/Madrid)' },
  { value: 'UTC', label: 'UTC' },
]

const LGPD_OPTIONS: { value: number; label: string }[] = [
  { value: 0, label: 'Desligado (padrão)' },
  { value: 30, label: '30 dias' },
  { value: 90, label: '90 dias' },
  { value: 180, label: '180 dias' },
  { value: 365, label: '1 ano' },
  { value: 730, label: '2 anos' },
]

interface SettingsData {
  defaultCurrency: string
  timezone: string
  revenueGoal: number
  outboundWebhook: string
  lgpdDays: number
  dailyReportHour: number
  pushcutTemplate: string
  apiScope: string
}

export function AccountPrefsCard() {
  const { data, mutate } = useSWR<SettingsData>('/api/settings', fetcher, { revalidateOnFocus: false })

  // edições locais: null = ainda não mexeu (usa o valor do servidor)
  const [draft, setDraft] = useState<Partial<SettingsData>>({})
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const v = <K extends keyof SettingsData>(k: K): SettingsData[K] | undefined =>
    (draft[k] !== undefined ? draft[k] : data?.[k]) as SettingsData[K] | undefined

  async function save() {
    setSaving(true)
    setSaveMsg(null)
    try {
      await apiSend('/api/settings', 'POST', {
        timezone: v('timezone') || 'America/Sao_Paulo',
        revenueGoal: Number(v('revenueGoal')) || 0,
        dailyReportHour: Number(v('dailyReportHour')) || 0,
        lgpdDays: Number(v('lgpdDays')) || 0,
        pushcutTemplate: String(v('pushcutTemplate') ?? '').trim(),
        outboundWebhook: String(v('outboundWebhook') ?? '').trim(),
      })
      await mutate()
      setDraft({})
      setSaveMsg({ ok: true, text: 'Preferências salvas' })
    } catch (e) {
      setSaveMsg({ ok: false, text: e instanceof Error ? e.message : 'Erro ao salvar' })
    } finally {
      setSaving(false)
      setTimeout(() => setSaveMsg(null), 3000)
    }
  }

  /* item 424 — teste de disparo do webhook */
  async function testWebhook() {
    setTesting(true)
    setTestMsg(null)
    try {
      const r = await apiSend<{ ok: boolean; status?: number; error?: string }>('/api/settings/webhook-test', 'POST', {})
      if (r.ok) setTestMsg({ ok: true, text: `Webhook respondeu HTTP ${r.status}` })
      else setTestMsg({ ok: false, text: r.error || `Destino respondeu HTTP ${r.status}` })
    } catch (e) {
      setTestMsg({ ok: false, text: e instanceof Error ? e.message : 'Falha no teste' })
    } finally {
      setTesting(false)
    }
  }

  const selectCls =
    'rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50'
  const goalReais = v('revenueGoal') ? Math.round(Number(v('revenueGoal')) / 100) : 0

  return (
    <GlassCard className="p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <Globe2 className="size-4 text-[color:var(--brand-cyan)]" />
        <div>
          <h2 className="section-head text-sm font-semibold text-foreground">Preferências da conta</h2>
          <p className="text-xs text-muted-foreground">
            Fuso, meta de receita, resumo diário, webhook de saída e retenção LGPD
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-tz">
            Fuso horário
          </label>
          <select
            id="pref-tz"
            className={`${selectCls} w-full`}
            value={v('timezone') ?? 'America/Sao_Paulo'}
            disabled={!data}
            onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
          >
            {TIMEZONES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">Corte do dia e horário do resumo</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-goal">
            Meta de receita mensal
          </label>
          <input
            id="pref-goal"
            type="number"
            min={0}
            step={100}
            className={inputCls}
            value={goalReais || ''}
            placeholder="0 = sem meta"
            disabled={!data}
            onChange={(e) => setDraft((d) => ({ ...d, revenueGoal: Math.round((parseFloat(e.target.value) || 0) * 100) }))}
          />
          <p className="mt-1 text-[11px] text-muted-foreground">Em {data?.defaultCurrency || 'BRL'}, sem centavos</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-drh">
            Resumo diário a partir das
          </label>
          <select
            id="pref-drh"
            className={`${selectCls} w-full`}
            value={String(v('dailyReportHour') ?? 0)}
            disabled={!data}
            onChange={(e) => setDraft((d) => ({ ...d, dailyReportHour: parseInt(e.target.value, 10) }))}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">Hora local do fuso escolhido</p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-lgpd">
            Retenção LGPD
          </label>
          <select
            id="pref-lgpd"
            className={`${selectCls} w-full`}
            value={String(v('lgpdDays') ?? 0)}
            disabled={!data}
            onChange={(e) => setDraft((d) => ({ ...d, lgpdDays: parseInt(e.target.value, 10) }))}
          >
            {LGPD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">Anonimiza e-mail/telefone de leads antigos</p>
        </div>
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-pctpl">
          Mensagem da venda no Pushcut
          <span className="font-normal"> — variáveis: {'{{valor}} {{pais}} {{produto}} {{gateway}} {{cliente}} {{pedido}}'}</span>
        </label>
        <input
          id="pref-pctpl"
          className={`${inputCls} font-mono text-xs`}
          maxLength={300}
          value={v('pushcutTemplate') ?? ''}
          placeholder="ex.: Cha-ching! {{valor}} de {{pais}} no {{gateway}}"
          disabled={!data}
          onChange={(e) => setDraft((d) => ({ ...d, pushcutTemplate: e.target.value }))}
        />
      </div>

      <div className="mt-4 border-t border-border pt-4">
        <label className="mb-1 block text-xs font-medium text-muted-foreground" htmlFor="pref-webhook">
          Webhook de saída <span className="font-normal">— POST JSON a cada venda aprovada (CRM, Zapier, planilha)</span>
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="pref-webhook"
            className={`${inputCls} min-w-56 flex-1 font-mono text-xs`}
            value={v('outboundWebhook') ?? ''}
            placeholder="https://seu-endpoint.com/webhook"
            disabled={!data}
            onChange={(e) => setDraft((d) => ({ ...d, outboundWebhook: e.target.value }))}
          />
          <button type="button" onClick={testWebhook} disabled={testing || !data?.outboundWebhook} className={btnGhost}>
            {testing ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />}
            Testar disparo
          </button>
        </div>
        {testMsg && (
          <p className={`mt-2 text-xs ${testMsg.ok ? 'text-success' : 'anim-shake text-destructive'}`} role="status">
            {testMsg.text}
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center justify-end gap-3">
        {saveMsg && (
          <span className={`text-xs ${saveMsg.ok ? 'text-success' : 'anim-shake text-destructive'}`} role="status">
            {saveMsg.text}
          </span>
        )}
        <button type="button" onClick={save} disabled={saving || !data} className={btnPrimary}>
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : null}
          Salvar preferências
        </button>
      </div>
    </GlassCard>
  )
}
