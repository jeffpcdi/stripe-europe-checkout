'use client'

import { useMemo } from 'react'
import { Link2, ShieldCheck } from 'lucide-react'
import { useCloakEntries, useLinks } from '@/lib/api'

interface DestinationOption {
  key: string
  label: string
  url: string
  displayUrl: string
  kind: 'link' | 'cloak'
}

export function AdDestinationField({
  id,
  value,
  onChange,
  disabled = false,
  label = 'Página de destino',
  compact = false,
  cloakTrafficSource,
}: {
  id: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  label?: string
  compact?: boolean
  cloakTrafficSource?: 'tiktok_standard' | 'tiktok_smart_plus'
}) {
  const { data: linksData } = useLinks()
  const { data: cloakData } = useCloakEntries()

  const options = useMemo<DestinationOption[]>(() => {
    const rows: DestinationOption[] = []
    const base = String(linksData?.baseUrl || '').replace(/\/$/, '')

    for (const link of linksData?.links ?? []) {
      if (!link.ativo || link.arquivado) continue
      if (link.dominio && !link.dominioValidado) continue
      const root = link.dominio ? `https://${link.dominio}` : base
      if (!root) continue
      rows.push({
        key: `link:${link.slug}`,
        label: link.nome,
        url: `${root}/${link.slug}`,
        displayUrl: `${root}/${link.slug}`,
        kind: 'link',
      })
    }

    for (const campaign of cloakData?.entries ?? []) {
      if (!campaign.enabled) continue
      const source = campaign.trafficSource || 'tiktok_standard'
      if (cloakTrafficSource && source !== cloakTrafficSource) continue
      const publicUrl = campaign.linkKit?.url
        || (campaign.dominio ? `https://${campaign.dominio}/${campaign.slug}` : '')
      const url = campaign.linkKit?.combinedUrl || publicUrl
      if (!/^https:\/\//.test(url)) continue
      rows.push({
        key: `cloak:${campaign.id || campaign.campaignId || campaign.slug}`,
        label: campaign.nome,
        url,
        displayUrl: publicUrl,
        kind: 'cloak',
      })
    }

    return rows
  }, [cloakData?.entries, cloakTrafficSource, linksData?.baseUrl, linksData?.links])

  const matched = options.find((option) => option.url === value.trim())
  const selectValue = matched?.key || 'custom'

  return (
    <div className={compact ? 'space-y-2' : 'space-y-2.5'}>
      <label htmlFor={id} className="block text-xs font-medium text-foreground">{label}</label>

      {options.length > 0 && (
        <select
          value={selectValue}
          disabled={disabled}
          onChange={(event) => {
            const next = event.target.value
            if (next === 'custom') {
              if (matched) onChange('')
              return
            }
            const option = options.find((item) => item.key === next)
            if (option) onChange(option.url)
          }}
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors focus:border-brand-cyan/60"
          aria-label="Escolher destino salvo no ROI-NADOS"
        >
          <option value="custom">URL personalizada</option>
          {options.some((option) => option.kind === 'link') && (
            <optgroup label="Links de venda">
              {options.filter((option) => option.kind === 'link').map((option) => (
                <option key={option.key} value={option.key}>{option.label} · {option.displayUrl.replace(/^https?:\/\//, '')}</option>
              ))}
            </optgroup>
          )}
          {options.some((option) => option.kind === 'cloak') && (
            <optgroup label="Campanhas Cloaker">
              {options.filter((option) => option.kind === 'cloak').map((option) => (
                <option key={option.key} value={option.key}>{option.label} · {option.displayUrl.replace(/^https?:\/\//, '')}</option>
              ))}
            </optgroup>
          )}
        </select>
      )}

      <div className="relative">
        {matched
          ? matched.kind === 'cloak'
            ? <ShieldCheck className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-cyan" aria-hidden="true" />
            : <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-brand-cyan" aria-hidden="true" />
          : <Link2 className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
        <input
          id={id}
          type="url"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://seusite.com/oferta"
          className="h-11 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-brand-cyan/60"
        />
      </div>

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {matched
          ? matched.kind === 'cloak'
            ? 'Campanha Cloaker selecionada. O ROI-NADOS envia o Link Kit completo, incluindo token e macros de atribuição compatíveis com a fonte configurada.'
            : 'Link de venda selecionado. O ROI-NADOS usa a URL rastreada e adiciona a atribuição da campanha no envio ao TikTok.'
          : options.length
            ? 'Escolha um destino já configurado no ROI-NADOS ou informe uma URL HTTPS personalizada.'
            : 'Nenhum destino salvo disponível. Informe uma URL HTTPS personalizada ou crie um Link/Campanha Cloaker primeiro.'}
      </p>
    </div>
  )
}
