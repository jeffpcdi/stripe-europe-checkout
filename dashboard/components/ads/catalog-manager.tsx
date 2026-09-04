'use client'

// Orquestrador visual do domínio de catálogos. As responsabilidades de conexão,
// prontidão e criação de campanha ficam em componentes próprios; esta tela
// concentra produtos, importação e histórico.

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  X, Loader2, Plus, Trash2, UploadCloud, Download,
  Copy, Check, AlertCircle, ChevronLeft, PackageOpen,
  Building2, Clock, ShieldCheck, RefreshCw, Pencil, ImageIcon,
  Link2, ChevronDown, History, CopyPlus, SearchCheck, RotateCcw,
} from 'lucide-react'
import {
  useAdsCatalogs, useAdsCatalogDetail, useAdsCatalogSpec, useAdsCatalogBusinessCenter,
  useAdsCatalogPublications, useAdsCatalogReadiness, useAdsCatalogCapabilities, adsCatalogImportCsv,
  adsCatalogApiUrl, apiSend, ApiError,
} from '@/lib/api'
import { toast } from '@/lib/toast'
import type { AdsCatalog, AdsCatalogCapabilities, AdsCatalogProduct, AdsCatalogSpecResponse, AdsCatalogSyncResponse } from '@/lib/types'
import { useModalA11y } from '@/lib/use-modal-a11y'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ErrorState } from '@/components/error-state'
import { CatalogReadinessCard } from './catalog-readiness-card'
import { CatalogConnectionCard } from './catalog-connection-card'
import { CatalogCampaignWizard } from './catalog-campaign-wizard'
import { CatalogBatchDialog } from './catalog-batch-dialog'
import { CatalogSyncStatus } from './catalog-sync-status'

import { CatalogList, BusinessCenterBar } from './catalog-list'
import { CatalogDetail } from './catalog-detail'

export function CatalogManager({
  advertiserId,
  advertiserLabel,
  advertiserCurrency,
}: {
  advertiserId: string
  advertiserLabel: string
  advertiserCurrency: string
}) {
  const { data: list, mutate: mutateList, isLoading: listLoading, error: listError } = useAdsCatalogs(true, advertiserId)
  const { data: spec } = useAdsCatalogSpec(true, advertiserId)
  const { data: bc, mutate: mutateBc } = useAdsCatalogBusinessCenter(true, advertiserId)
  const { data: capabilitiesData } = useAdsCatalogCapabilities(true, advertiserId)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // Um catalogId só é válido dentro do advertiser que o criou. Ao trocar a
  // seleção global, voltamos à lista antes de qualquer request de detalhe.
  useEffect(() => setSelectedId(null), [advertiserId])

  const enabled = list?.enabled !== false

  if (!enabled) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-background p-8 text-center">
        <AlertCircle className="size-6 text-warning" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">Persistência indisponível</p>
        <p className="max-w-md text-pretty text-xs text-muted-foreground">
          O banco de dados (Neon) não está configurado, então catálogos não podem ser salvos. Conecte o
          Neon nas configurações do projeto para usar este recurso.
        </p>
      </div>
    )
  }

  if (listError) {
    return (
      <ErrorState
        title="Não foi possível carregar os catálogos"
        description="A seleção da conta foi preservada. Tente novamente sem criar ou apagar nada."
        onRetry={() => mutateList()}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {(!bc?.bcId || !selectedId) && (
        <BusinessCenterBar
          advertiserId={advertiserId}
          bcId={bc?.bcId ?? ''}
          fromEnv={Boolean(bc?.fromEnv)}
          autoDetected={Boolean(bc?.autoDetected)}
          discoveryError={Boolean(bc?.discoveryError)}
          candidates={bc?.candidates ?? []}
          loading={bc === undefined}
          onChanged={mutateBc}
        />
      )}
      {selectedId ? (
        <CatalogDetail
          catalogId={selectedId}
          spec={spec ?? null}
          advertiserId={advertiserId}
          advertiserLabel={advertiserLabel}
          advertiserCurrency={advertiserCurrency}
          bcId={bc?.bcId ?? ''}
          bcConfigured={Boolean(bc?.bcId)}
          catalogCapabilities={capabilitiesData?.capabilities ?? null}
          onBusinessCenterChanged={mutateBc}
          onBack={() => {
            setSelectedId(null)
            mutateList()
          }}
          onDeleted={() => {
            setSelectedId(null)
            mutateList()
          }}
          onCloned={(cloneId) => {
            mutateList()
            setSelectedId(cloneId)
          }}
        />
      ) : (
        <CatalogList
          catalogs={list?.catalogs ?? []}
          advertiserId={advertiserId}
          advertiserCurrency={advertiserCurrency}
          spec={spec ?? null}
          loading={listLoading && !list}
          onOpen={setSelectedId}
          onChanged={mutateList}
        />
      )}
    </div>
  )
}
