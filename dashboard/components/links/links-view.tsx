'use client'

import { useEffect, useState } from 'react'
import { Link2, Plus, Copy, Check, Pencil, Trash2, Globe, Languages, QrCode, TriangleAlert } from 'lucide-react'
import QRCodeLib from 'qrcode'
import { useLinks, useDomains, apiSend } from '@/lib/api'
import type { CheckoutLink } from '@/lib/types'
import { GlassCard } from '@/components/glass-card'
import { Skeleton } from '@/components/skeleton'
import { TutorialButton, TutorialModal, type TutorialStep } from '@/components/tutorial-modal'
import { LinkEditor } from './link-editor'

const LINK_STEPS: TutorialStep[] = [
  {
    title: 'O que é um link de checkout',
    body: (
      <>
        É um link <code>/go/seu-slug</code> que você usa nos anúncios. Ele rastreia o clique, aplica
        cloaker e split A/B quando você quiser, e leva o visitante ao checkout certo.
      </>
    ),
  },
  {
    title: '1. Crie o link',
    body: (
      <>
        Clique em <strong>Novo link</strong>, dê um nome e defina o <code>slug</code> (o final da URL).
        Adicione uma ou mais <strong>variantes</strong> de destino para testar ofertas (split A/B).
      </>
    ),
    tip: 'Com 2+ variantes, o tráfego é dividido automaticamente e você compara a conversão de cada uma.',
  },
  {
    title: '2. Use domínio próprio (opcional)',
    body: (
      <>
        Se você verificou um domínio na aba <strong>Domínios</strong>, escolha-o aqui para o link sair
        com a sua marca em vez do domínio padrão.
      </>
    ),
  },
  {
    title: '3. Cloaker e segmentação',
    body: (
      <>
        Configure página branca (white page), países e idiomas permitidos. Assim, quem não é público-alvo
        (ou o robô de revisão) vê a página segura, e o comprador real vê a oferta.
      </>
    ),
    tip: 'Copie a URL pronta pelo botão de copiar ou gere um QR code para mídia offline.',
  },
]

export function LinksView() {
  const { data, isLoading, mutate } = useLinks()
  const { data: domainsData } = useDomains()
  const [editing, setEditing] = useState<CheckoutLink | null>(null)
  const [creating, setCreating] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Item 71: QR code em popover glass por link — gerado LOCALMENTE (a URL do
  // link nunca sai para um serviço de terceiros)
  const [qrFor, setQrFor] = useState<string | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [showTutorial, setShowTutorial] = useState(false)

  const appHost = domainsData?.appHost ?? ''
  const links = data?.links ?? []
  const verifiedHosts = new Set((domainsData?.domains ?? []).filter((d) => d.verificado).map((d) => d.host))

  // Gera o QR no navegador quando o popover abre
  useEffect(() => {
    if (!qrFor) {
      setQrDataUrl(null)
      return
    }
    const link = links.find((l) => l.slug === qrFor)
    if (!link) return
    const url = `https://${link.dominio || appHost}/go/${link.slug}`
    let alive = true
    QRCodeLib.toDataURL(url, {
      width: 140,
      margin: 1,
      color: { dark: '#25f4ee', light: '#0d0d10' },
    })
      .then((d) => {
        if (alive) setQrDataUrl(d)
      })
      .catch(() => {
        if (alive) setQrDataUrl(null)
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrFor, appHost])

  function publicUrl(l: CheckoutLink) {
    const host = l.dominio || appHost
    return `https://${host}/go/${l.slug}`
  }

  async function copyUrl(l: CheckoutLink) {
    await navigator.clipboard.writeText(publicUrl(l))
    setCopied(l.slug)
    setTimeout(() => setCopied(null), 1500)
  }

  async function handleDelete(slug: string) {
    await apiSend(`/api/links/${encodeURIComponent(slug)}`, 'DELETE')
    setDeleting(null)
    mutate()
  }

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28" />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {links.length} link{links.length === 1 ? '' : 's'} de checkout
        </p>
        <div className="flex items-center gap-2">
          <TutorialButton onClick={() => setShowTutorial(true)} />
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-cyan)] px-3 py-2 text-sm font-semibold text-black shadow-[var(--glow-cyan-soft)] transition-all hover:-translate-y-px hover:shadow-[var(--glow-cyan)] hover:brightness-105 active:scale-[0.98]"
          >
            <Plus className="size-4" /> Novo link
          </button>
        </div>
      </div>

      <TutorialModal
        open={showTutorial}
        onClose={() => setShowTutorial(false)}
        title="Como criar seus links de checkout"
        steps={LINK_STEPS}
      />

      {links.length === 0 ? (
        <GlassCard className="flex flex-col items-center gap-3 p-10 text-center">
          <Link2 className="size-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground text-pretty">
            Nenhum link ainda. Crie um link /go/slug com split A/B, cloak e domínio próprio.
          </p>
        </GlassCard>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((l) => {
            const clicks = l.variantes.reduce((s, v) => s + v.clicks, 0)
            const convs = l.variantes.reduce((s, v) => s + v.conversions, 0)
            return (
              /* Item 69: hover eleva com sheen; slug em mono ciano */
              <GlassCard
                key={l.slug}
                className="sheen p-4 transition-transform duration-150 hover:-translate-y-0.5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{l.nome}</h3>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                          l.ativo
                            ? 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
                            : 'bg-muted/40 text-muted-foreground'
                        }`}
                      >
                        {l.ativo ? 'Ativo' : 'Pausado'}
                      </span>
                      {l.urlWhitePage && (
                        <span className="rounded-md bg-[color:var(--brand-pink)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--brand-pink)]">
                          Cloak
                        </span>
                      )}
                      {/* Aviso: o link usa domínio próprio que ainda não verificou — a URL vai dar erro */}
                      {l.dominio && !verifiedHosts.has(l.dominio) && (
                        <span
                          className="flex items-center gap-1 rounded-md bg-[color:var(--warning)]/15 px-1.5 py-0.5 text-[11px] font-medium text-[color:var(--warning)]"
                          title={`O domínio ${l.dominio} ainda não foi verificado na aba Domínios — este link não funciona até verificar.`}
                        >
                          <TriangleAlert className="size-3" aria-hidden="true" /> domínio não verificado
                        </span>
                      )}
                    </div>
                    <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                      https://{l.dominio || appHost}/go/
                      <span className="text-primary">{l.slug}</span>
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        {l.variantes.length} variante{l.variantes.length === 1 ? '' : 's'}
                      </span>
                      <span className="tabular-nums">{clicks} cliques</span>
                      <span className="tabular-nums">{convs} conversões</span>
                      {l.paises.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Globe className="size-3" /> {l.paises.join(', ')}
                        </span>
                      )}
                      {l.idiomas.length > 0 && (
                        <span className="flex items-center gap-1">
                          <Languages className="size-3" /> {l.idiomas.join(', ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative flex shrink-0 items-center gap-1">
                    {/* Item 70: morph clipboard → check com rotação spring */}
                    <button
                      type="button"
                      onClick={() => copyUrl(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Copiar URL"
                    >
                      {copied === l.slug ? (
                        <Check className="anim-pop-in size-4 text-[color:var(--success)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </button>
                    {/* Item 71: QR code em popover glass */}
                    <button
                      type="button"
                      onClick={() => setQrFor(qrFor === l.slug ? null : l.slug)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Ver QR code"
                      aria-expanded={qrFor === l.slug}
                    >
                      <QrCode className="size-4" />
                    </button>
                    {qrFor === l.slug && (
                      <div className="glass glass-thick anim-pop-in absolute right-0 top-11 z-20 flex flex-col items-center gap-2 p-3">
                        {qrDataUrl ? (
                          /* eslint-disable-next-line @next/next/no-img-element */
                          <img
                            src={qrDataUrl || "/placeholder.svg"}
                            alt={`QR code do link ${l.nome}`}
                            width={140}
                            height={140}
                            className="rounded-md"
                          />
                        ) : (
                          <div className="flex size-[140px] items-center justify-center rounded-md bg-secondary/60">
                            <QrCode className="size-6 animate-pulse text-muted-foreground" aria-hidden="true" />
                          </div>
                        )}
                        <span className="font-mono text-[10px] text-muted-foreground">/go/{l.slug}</span>
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(l)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                      aria-label="Editar link"
                    >
                      <Pencil className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleting(l.slug)}
                      className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      aria-label="Excluir link"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {deleting === l.slug && (
                  <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
                    <p className="text-sm text-foreground">
                      Excluir <strong>{l.nome}</strong>? A URL /go/{l.slug} deixa de funcionar.
                    </p>
                    <div className="flex shrink-0 gap-2">
                      <button
                        type="button"
                        onClick={() => setDeleting(null)}
                        className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(l.slug)}
                        className="rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90"
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                )}
              </GlassCard>
            )
          })}
        </div>
      )}

      {(creating || editing) && (
        <LinkEditor
          link={editing}
          domains={domainsData?.domains ?? []}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            mutate()
          }}
        />
      )}
    </div>
  )
}
