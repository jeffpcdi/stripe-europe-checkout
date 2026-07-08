'use client'

import { useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CloakEntry, CloakSensitivity } from '@/lib/types'

interface Props {
  entry: CloakEntry | null
  onClose: () => void
  onSaved: () => void
}

const SENSITIVITIES: { value: CloakSensitivity; label: string }[] = [
  { value: 'strict', label: 'Rígido' },
  { value: 'balanced', label: 'Equilibrado' },
  { value: 'loose', label: 'Frouxo' },
]

export function CloakEntryEditor({ entry, onClose, onSaved }: Props) {
  const [nome, setNome] = useState(entry?.nome ?? '')
  const [offerUrl, setOfferUrl] = useState(entry?.offerUrl ?? '')
  const [whitePageUrl, setWhitePageUrl] = useState(entry?.whitePageUrl ?? '')
  const [dominio, setDominio] = useState(entry?.dominio ?? '')
  const [enabled, setEnabled] = useState(entry?.enabled ?? true)
  const [mobileOnly, setMobileOnly] = useState(entry?.mobileOnly ?? true)
  const [requireAdClick, setRequireAdClick] = useState(entry?.requireAdClick ?? true)
  const [sensitivity, setSensitivity] = useState<CloakSensitivity>(entry?.sensitivity ?? 'balanced')
  const [paises, setPaises] = useState((entry?.paises ?? []).join(', '))
  const [idiomas, setIdiomas] = useState((entry?.idiomas ?? []).join(', '))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSave() {
    setError(null)
    if (!nome.trim() && !entry) return setError('Dê um nome ao link')
    if (!/^https:\/\//.test(offerUrl.trim())) return setError('A offer precisa ser uma URL https:// válida')
    setSaving(true)
    try {
      await apiSend('/api/cloak/entries', 'POST', {
        slug: entry?.slug,
        nome: nome.trim(),
        offerUrl: offerUrl.trim(),
        whitePageUrl: whitePageUrl.trim(),
        dominio: dominio.trim(),
        enabled,
        mobileOnly,
        requireAdClick,
        sensitivity,
        paises: paises.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
        idiomas: idiomas.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border bg-secondary/60 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-[color:var(--brand-cyan)] focus:outline-none'
  const labelCls = 'mb-1 block text-xs font-medium text-muted-foreground'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-card p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">
            {entry ? 'Editar link de cloaking' : 'Novo link de cloaking'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-4">
          <div>
            <label className={labelCls} htmlFor="ck-nome">Nome</label>
            <input id="ck-nome" className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Campanha BR - Oferta X" />
          </div>

          <div>
            <label className={labelCls} htmlFor="ck-offer">Offer (URL https)</label>
            <input id="ck-offer" className={inputCls} value={offerUrl} onChange={(e) => setOfferUrl(e.target.value)} placeholder="https://minha-oferta.com" />
          </div>

          <div>
            <label className={labelCls} htmlFor="ck-white">Página branca (opcional)</label>
            <input id="ck-white" className={inputCls} value={whitePageUrl} onChange={(e) => setWhitePageUrl(e.target.value)} placeholder="https://pagina-segura.com" />
          </div>

          <div>
            <label className={labelCls} htmlFor="ck-dom">Domínio personalizado (opcional)</label>
            <input id="ck-dom" className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="go.meudominio.com" />
          </div>

          <div>
            <label className={labelCls} htmlFor="ck-sens">Sensibilidade da detecção</label>
            <select id="ck-sens" className={inputCls} value={sensitivity} onChange={(e) => setSensitivity(e.target.value as CloakSensitivity)}>
              {SENSITIVITIES.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls} htmlFor="ck-paises">Países (ISO, separados por vírgula)</label>
              <input id="ck-paises" className={inputCls} value={paises} onChange={(e) => setPaises(e.target.value)} placeholder="BR, PT" />
            </div>
            <div>
              <label className={labelCls} htmlFor="ck-idiomas">Idiomas</label>
              <input id="ck-idiomas" className={inputCls} value={idiomas} onChange={(e) => setIdiomas(e.target.value)} placeholder="pt, es" />
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-border pt-4">
            <ToggleRow label="Link ativo" checked={enabled} onChange={setEnabled} />
            <ToggleRow label="Apenas mobile" hint="Bloqueia acessos desktop" checked={mobileOnly} onChange={setMobileOnly} />
            <ToggleRow label="Exigir clique de anúncio" hint="Exige parâmetro de ad-click válido" checked={requireAdClick} onChange={setRequireAdClick} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-4 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {saving && <Loader2 className="size-3.5 animate-spin" />}
              {entry ? 'Salvar' : 'Criar link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>
        <span className="block text-sm text-foreground">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-[color:var(--brand-cyan)]' : 'bg-secondary'}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
    </label>
  )
}
