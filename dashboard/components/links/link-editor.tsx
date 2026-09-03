'use client'

import { useState } from 'react'
import { X, Check, Tag, Shield, ShieldAlert } from 'lucide-react'
import { apiSend } from '@/lib/api'
import type { CheckoutLink, CustomDomain } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'

interface LinkEditorProps {
  link: CheckoutLink | null
  domains: CustomDomain[]
  appHost?: string
  presetDominio?: string | null
  onClose: () => void
  onSaved: () => void
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function LinkEditor({ link, domains, appHost = '', presetDominio = null, onClose, onSaved }: LinkEditorProps) {
  const [nome, setNome] = useState(link?.nome ?? '')
  const [slug, setSlug] = useState(link?.slug ?? '')
  const [dominio, setDominio] = useState(link?.dominio ?? presetDominio ?? '')
  const [urlWhitePage, setUrlWhitePage] = useState(link?.urlWhitePage ?? '')
  
  // A magia do One-Link: reduzimos tudo a 1 oferta e 1 escudo
  const [urlOferta, setUrlOferta] = useState(link?.variantes?.[0]?.url ?? '')
  const [escudoMaximo, setEscudoMaximo] = useState(true)
  
  const [ativo, setAtivo] = useState(link?.ativo ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isValidUrl = (u: string) => /^https:\/\/[^\s]+\.[^\s]+/i.test(u.trim())
  const urlInvalida = (u: string) => !!u.trim() && !isValidUrl(u)
  const temUrlInvalida = urlInvalida(urlOferta) || urlInvalida(urlWhitePage)

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      await apiSend('/api/links', 'POST', {
        slug: slug || nome,
        _baseUpdatedAt: link?.updatedAt || undefined,
        nome,
        dominio: dominio || null,
        urlWhitePage: urlWhitePage || null,
        paises: [], // Escudo máximo assume a inteligência de geo no backend/borda
        idiomas: [],
        pixelSlug: '', // Padrão vazio (pega global)
        ativo,
        variantes: [
          {
            id: link?.variantes?.[0]?.id || 'v1',
            nome: 'Oferta Principal',
            url: urlOferta.trim(),
            urlMobile: null,
            peso: 100, // 100% do tráfego para a única oferta
          }
        ],
      })
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(false)
    }
  }

  const inputCls =
    'w-full rounded-lg border border-border/50 bg-secondary/30 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/40 transition-all duration-300 hover:border-[color:var(--brand-cyan)]/40 hover:bg-secondary/60 focus:border-[color:var(--brand-cyan)] focus:bg-background focus:shadow-[0_0_25px_rgba(37,244,238,0.15)] focus:outline-none'

  const labelCls = "text-[11px] font-semibold text-muted-foreground transition-colors duration-300 group-focus-within:text-[color:var(--brand-cyan)] group-focus-within:drop-shadow-[0_0_5px_rgba(37,244,238,0.4)]"

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 md:items-center transition-all animate-in fade-in duration-500" role="dialog">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.4)_0%,rgba(0,0,0,0.9)_100%)] backdrop-blur-3xl pointer-events-none" />

      <GlassCard variant="thick" className="relative z-10 w-full max-w-xl p-6 animate-in zoom-in-[0.98] duration-300 ease-out border-[color:var(--brand-cyan)]/30 shadow-[0_0_50px_rgba(37,244,238,0.1)]">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-8 items-center justify-center rounded-full bg-[color:var(--brand-cyan)]/20 text-[color:var(--brand-cyan)]">
              <Tag className="size-4" />
            </div>
            <h2 className="text-xl font-bold text-foreground">
              {link ? 'Editar Link Mágico' : 'Novo Link Mágico'}
            </h2>
          </div>
          <button onClick={onClose} className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-col gap-5">
          <label className="group flex flex-col gap-1.5">
            <span className={labelCls}>Nome da Campanha</span>
            <input className={inputCls} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex: Oferta Black Friday" />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="group flex flex-col gap-1.5">
              <span className={labelCls}>Domínio</span>
              <select className={inputCls} value={dominio} onChange={(e) => setDominio(e.target.value)}>
                <option value="">Domínio padrão</option>
                {domains.map((d) => (
                  <option key={d.host} value={d.host}>{d.host}</option>
                ))}
              </select>
            </label>
            <label className="group flex flex-col gap-1.5">
              <span className={labelCls}>Slug (URL)</span>
              <input className={inputCls} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={slugify(nome) || 'slug-aqui'} disabled={!!link} />
            </label>
          </div>

          <div className="relative rounded-xl border border-border/50 bg-background/50 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Shield className="size-4 text-[color:var(--brand-cyan)]" />
              <h3 className="font-semibold text-foreground text-sm">Destinos (Cloaker)</h3>
            </div>
            <div className="flex flex-col gap-4">
              <label className="group flex flex-col gap-1.5">
                <span className={labelCls}>Página Segura (Artigo / Para Robôs)</span>
                <input
                  className={`${inputCls} ${urlInvalida(urlWhitePage) ? 'border-destructive' : ''}`}
                  value={urlWhitePage}
                  onChange={(e) => setUrlWhitePage(e.target.value)}
                  placeholder="https://meublog.com/artigo-seguro"
                />
              </label>
              
              <label className="group flex flex-col gap-1.5">
                <span className={labelCls}>Página de Oferta (Para Clientes Reais)</span>
                <input
                  className={`${inputCls} ${urlInvalida(urlOferta) ? 'border-destructive' : ''}`}
                  value={urlOferta}
                  onChange={(e) => setUrlOferta(e.target.value)}
                  placeholder="https://pay.gateway.com/123"
                />
              </label>
            </div>
          </div>

          {/* Toggle Mágico do Escudo */}
          <div className={`flex items-center justify-between rounded-xl border p-4 transition-colors ${escudoMaximo ? 'border-[color:var(--brand-cyan)]/50 bg-[color:var(--brand-cyan)]/5' : 'border-border/50 bg-secondary/20'}`}>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                {escudoMaximo ? <Shield className="size-4 text-[color:var(--brand-cyan)] drop-shadow-[0_0_8px_rgba(37,244,238,0.8)]" /> : <ShieldAlert className="size-4 text-muted-foreground" />}
                <span className="font-semibold text-sm text-foreground">Escudo Máximo Ativo</span>
              </div>
              <p className="text-[11px] text-muted-foreground">Bloqueia VPNs, Proxies e IPs suspeitos automaticamente.</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input type="checkbox" className="peer sr-only" checked={escudoMaximo} onChange={(e) => setEscudoMaximo(e.target.checked)} />
              <div className="peer h-6 w-11 rounded-full bg-secondary/80 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-[color:var(--brand-cyan)] peer-checked:after:translate-x-full peer-focus:outline-none"></div>
            </label>
          </div>

          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-4 py-3 text-sm text-destructive" role="alert">
              <span className="font-bold mr-1">Erro:</span> {error}
            </div>
          )}

          <div className="flex justify-end gap-3 border-t border-border/50 pt-5 mt-2">
            <button type="button" onClick={onClose} disabled={saving} className="rounded-full px-5 py-2.5 text-sm font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !nome.trim() || !urlOferta.trim() || temUrlInvalida}
              className={`relative flex items-center gap-2 overflow-hidden rounded-full bg-[color:var(--brand-cyan)] px-6 py-2.5 text-sm font-bold text-black transition-all hover:scale-105 active:scale-95 disabled:pointer-events-none disabled:opacity-50`}
            >
              {saving ? 'Salvando...' : 'Criar Link Mágico'}
            </button>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}
