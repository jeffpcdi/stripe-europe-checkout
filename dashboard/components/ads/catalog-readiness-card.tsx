'use client'

import { AlertCircle, Check, Circle, Loader2 } from 'lucide-react'
import type { AdsCatalogReadiness } from '@/lib/types'

const ACTION_LABEL: Record<AdsCatalogReadiness['nextAction'], string> = {
  add_products: 'Adicionar produtos',
  fix_products: 'Corrigir produtos',
  connect_tiktok: 'Conectar ao TikTok',
  verify_link: 'Verificar vínculo',
  sync: 'Sincronizar catálogo',
  refresh_audit: 'Atualizar análise',
  select_advertiser: 'Selecionar conta',
  create_campaign: 'Criar campanha',
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
  return (
    <section className="rounded-xl border border-border bg-background p-4" aria-labelledby="catalog-readiness-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="catalog-readiness-title" className="text-xs font-semibold text-foreground">Prontidão do catálogo</h3>
          <p className="mt-0.5 text-[11px] text-muted-foreground">A campanha só é liberada quando as dependências reais estão confirmadas.</p>
        </div>
        {readiness && onAction && (
          <button type="button" className="btn-primary text-xs" onClick={() => onAction(readiness.nextAction)}>
            {ACTION_LABEL[readiness.nextAction]}
          </button>
        )}
      </div>
      {loading && !readiness ? (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Verificando…</div>
      ) : (
        <ol className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {(readiness?.steps ?? []).map((item) => (
            <li key={item.id} className={`rounded-lg border p-3 ${item.state === 'blocked' ? 'border-error/30 bg-error/5' : item.state === 'done' ? 'border-success/25 bg-success/5' : 'border-border bg-card'}`}>
              <div className="flex items-start gap-2">
                {item.state === 'done' ? <Check className="mt-0.5 size-3.5 text-success" /> : item.state === 'active' ? <Loader2 className="mt-0.5 size-3.5 animate-spin text-primary" /> : item.state === 'blocked' ? <AlertCircle className="mt-0.5 size-3.5 text-error" /> : <Circle className="mt-0.5 size-3.5 text-muted-foreground" />}
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-foreground">{item.label}</p>
                  <p className="mt-0.5 text-pretty text-[10px] leading-relaxed text-muted-foreground">{item.detail}</p>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
