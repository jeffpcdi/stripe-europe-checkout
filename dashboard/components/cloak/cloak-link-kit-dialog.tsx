'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import type { CloakEntry } from '@/lib/types'
import { toast } from '@/lib/toast'

interface Props {
  campaign: CloakEntry | null
  onClose: () => void
}

function sourceLabel(campaign: CloakEntry) {
  if (campaign.linkKit?.trafficSourceLabel) return campaign.linkKit.trafficSourceLabel
  if (campaign.trafficSource === 'tiktok_smart_plus') return 'TikTok Smart+'
  if (campaign.trafficSource === 'tiktok_standard') return 'TikTok Standard'
  return 'Fonte personalizada'
}

export function CloakLinkKitDialog({ campaign, onClose }: Props) {
  const [copied, setCopied] = useState<'url' | 'params' | null>(null)
  const kit = campaign?.linkKit ?? null

  async function copy(value: string, kind: 'url' | 'params') {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(kind)
      window.setTimeout(() => setCopied(null), 1800)
    } catch {
      toast.error('Não foi possível copiar para a área de transferência.')
    }
  }

  return (
    <Modal
      isOpen={Boolean(campaign)}
      onClose={onClose}
      title={campaign ? `Usar "${campaign.nome}" no anúncio` : 'Usar no anúncio'}
      description="Copie a URL e os parâmetros exatamente como aparecem abaixo."
      maxWidth="max-w-2xl"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">Configuração gerada pelo ROI-NADOS para {campaign ? sourceLabel(campaign) : 'a fonte selecionada'}.</p>
          <button type="button" className="btn-primary h-10 px-4 text-sm" onClick={onClose}>Concluir</button>
        </div>
      }
    >
      {campaign && kit ? (
        <div className="space-y-6">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">URL do site</h3>
                <p className="mt-1 text-xs text-muted-foreground">Use no campo de URL do anúncio.</p>
              </div>
              <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => copy(kit.url, 'url')}>
                {copied === 'url' ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied === 'url' ? 'Copiada' : 'Copiar URL'}
              </button>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/70 bg-secondary/25 p-3">
              <code className="min-w-0 flex-1 break-all font-mono text-xs leading-5 text-foreground">{kit.url}</code>
              <a href={kit.url} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Abrir URL da campanha">
                <ExternalLink className="size-4" />
              </a>
            </div>
          </section>

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">Parâmetros da URL</h3>
                <p className="mt-1 text-xs text-muted-foreground">Cole no campo de parâmetros no nível do anúncio.</p>
              </div>
              <button type="button" className="btn-secondary h-9 px-3 text-xs" onClick={() => copy(kit.urlParams, 'params')}>
                {copied === 'params' ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
                {copied === 'params' ? 'Copiados' : 'Copiar parâmetros'}
              </button>
            </div>
            <div className="mt-3 rounded-xl border border-border/70 bg-secondary/25 p-3">
              <code className="block break-all font-mono text-xs leading-5 text-foreground">{kit.urlParams || 'Nenhum parâmetro necessário para esta fonte.'}</code>
            </div>
          </section>

          <section className="border-t border-border/60 pt-4">
            <h3 className="text-sm font-semibold text-foreground">Como usar</h3>
            <ol className="mt-3 space-y-2 text-sm leading-relaxed text-muted-foreground">
              <li><span className="font-medium text-foreground">1.</span> Abra o anúncio na plataforma selecionada.</li>
              <li><span className="font-medium text-foreground">2.</span> Cole a URL acima no campo de destino do site.</li>
              <li><span className="font-medium text-foreground">3.</span> Cole os parâmetros no campo de parâmetros da URL.</li>
            </ol>
          </section>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Esta campanha ainda não possui um kit de publicação disponível.</p>
      )}
    </Modal>
  )
}
