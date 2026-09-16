'use client'

import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react'
import type { AdsCatalogReadiness } from '@/lib/types'

export const CATALOG_ACTION_LABEL: Record<AdsCatalogReadiness['nextAction'], string> = {
  add_products: 'Adicionar produtos',
  fix_products: 'Revisar produtos',
  connect_tiktok: 'Conectar agora',
  verify_link: 'Verificar vínculo',
  sync: 'Sincronizar agora',
  refresh_audit: 'Atualizar análise',
  select_advertiser: 'Selecionar conta',
  create_campaign: 'Criar campanha',
}

const NEXT_ACTION_TITLE: Record<AdsCatalogReadiness['nextAction'], string> = {
  add_products: 'Adicione produtos',
  fix_products: 'Revise os produtos com erro',
  connect_tiktok: 'Conecte o catálogo ao TikTok',
  verify_link: 'Verifique o vínculo com o TikTok',
  sync: 'Sincronize as alterações',
  refresh_audit: 'Acompanhe a análise do TikTok',
  select_advertiser: 'Selecione a conta de anúncios',
  create_campaign: 'Pronto para criar campanha',
}

export function CatalogReadinessCard({
  readiness,
  loading,
  onAction,
}: {
  readiness?: AdsCatalogReadiness
  loading?: boolean
  onAction?: (action: AdsCatalogReadiness['nextAction']) => void
}) {
  if (loading && !readiness) {
    return (
      <section className="border-y border-border/60 py-4" aria-labelledby="catalog-readiness-title">
        <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin text-primary" /> Verificando o próximo passo…</div>
      </section>
    )
  }

  return (
    <section className="border-y border-border/60 py-4" aria-labelledby="catalog-readiness-title">
      {readiness && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-muted-foreground">Próximo passo</p>
            <h3 id="catalog-readiness-title" className="mt-0.5 text-sm font-semibold text-foreground">{NEXT_ACTION_TITLE[readiness.nextAction]}</h3>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              {readiness.steps.find((item) => item.state === 'blocked' || item.state === 'active')?.detail || readiness.steps[readiness.steps.length - 1]?.detail || 'O catálogo está pronto para a próxima etapa.'}
            </p>
          </div>
          {onAction && (
            <button type="button" className="btn-primary min-h-10 shrink-0 px-3.5 text-sm" onClick={() => onAction(readiness.nextAction)}>
              {CATALOG_ACTION_LABEL[readiness.nextAction]}
            </button>
          )}
        </div>
      )}

      <ol className="mt-4 divide-y divide-border/45 border-t border-border/45">
        {(readiness?.steps ?? []).map((item) => (
          <li key={item.id} className="flex items-start gap-2.5 py-2.5">
            {item.state === 'done' ? <Check className="mt-0.5 size-4 shrink-0 text-success" /> : item.state === 'active' ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : item.state === 'blocked' ? <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" /> : <Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">{item.label}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
