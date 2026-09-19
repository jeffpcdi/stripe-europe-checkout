'use client'

import { useEffect, useMemo, useState } from 'react'
import { Cloud, Loader2, RefreshCw } from 'lucide-react'
import { apiSend, useAdsCloudVideo } from '@/lib/api'
import { toast } from '@/lib/toast'

type ProviderKey = 'googleDrive' | 'dropbox'

const PROVIDERS: { key: ProviderKey; label: string; placeholder: string }[] = [
  { key: 'googleDrive', label: 'Google Drive', placeholder: 'Link ou ID da pasta' },
  { key: 'dropbox', label: 'Dropbox', placeholder: 'Ex.: /Criativos/TikTok' },
]

function normalizeFolder(provider: ProviderKey, value: string) {
  const clean = value.trim()
  if (provider !== 'googleDrive') return clean
  const match = clean.match(/\/folders\/([^/?#]+)/i)
  return match?.[1] ? decodeURIComponent(match[1]) : clean
}

function skipMessage(reason?: string) {
  if (reason === 'dry_run') return 'Modo simulação ativo: nenhum arquivo foi enviado ao TikTok.'
  if (reason === 'kill_switch') return 'Kill switch ativo: sincronização pausada.'
  if (reason === 'advertiser_blocked') return 'Esta conta está bloqueada pela política de segurança.'
  if (reason === 'safety_policy_disabled') return 'A política de segurança está desativada.'
  if (reason === 'safety_policy_unavailable') return 'Não foi possível validar a política de segurança agora.'
  if (reason === 'already_running') return 'Já existe uma sincronização em andamento.'
  return reason ? 'A sincronização foi adiada: ' + reason : 'A sincronização foi adiada.'
}

export function CloudVideoSyncPanel({
  advertiserId,
  onSynced,
}: {
  advertiserId: string
  onSynced?: () => void
}) {
  const { data, error, isLoading, mutate } = useAdsCloudVideo(Boolean(advertiserId))
  const [folders, setFolders] = useState<Record<ProviderKey, string>>({ googleDrive: '', dropbox: '' })
  const [working, setWorking] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return
    setFolders({
      googleDrive: data.providers.googleDrive.folderId || '',
      dropbox: data.providers.dropbox.folderPath || '',
    })
  }, [data])

  const visibleProviders = useMemo(
    () => PROVIDERS.filter(item => data?.providers[item.key]?.configured || data?.providers[item.key]?.connected),
    [data],
  )
  const safetyBlocked = Boolean(data && (!data.safety.enabled || data.safety.dryRun || data.safety.killSwitch))

  async function connect(provider: ProviderKey) {
    setWorking(provider + ':connect')
    try {
      const result = await apiSend<{ ok: boolean; url: string }>(`/api/ads/cloud-video/${provider}/connect`, 'POST', {})
      if (!result.url) throw new Error('URL de conexão não recebida')
      window.location.assign(result.url)
    } catch (err) {
      toast.error('Não foi possível conectar a nuvem', { hint: err instanceof Error ? err.message : undefined })
      setWorking(null)
    }
  }

  async function save(provider: ProviderKey, enabled: boolean) {
    const folder = normalizeFolder(provider, folders[provider])
    if (enabled && !folder) {
      toast.info(provider === 'googleDrive' ? 'Informe a pasta do Google Drive.' : 'Informe a pasta do Dropbox.')
      return
    }
    const key = provider + ':save'
    setWorking(key)
    try {
      const body: Record<string, unknown> = { advertiserId, enabled }
      if (provider === 'googleDrive') body.folderId = folder
      else body.folderPath = folder
      await apiSend(`/api/ads/cloud-video/${provider}`, 'PUT', body)

      if (enabled && !safetyBlocked) {
        const result = await apiSend<{ skipped?: boolean; reason?: string; files?: { ok?: boolean }[] }>(
          `/api/ads/cloud-video/${provider}/sync`,
          'POST',
          { advertiserId },
        )
        if (result.skipped) toast.info(skipMessage(result.reason))
        else {
          const imported = (result.files ?? []).filter(file => file.ok).length
          toast.success(imported ? `${imported} criativo(s) sincronizado(s)` : 'Sincronização ativada')
          onSynced?.()
        }
      } else {
        toast.success(enabled ? 'Sincronização automática ativada' : 'Sincronização pausada')
      }
      await mutate()
    } catch (err) {
      toast.error('Não foi possível atualizar a sincronização', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setWorking(null)
    }
  }

  async function syncNow(provider: ProviderKey) {
    setWorking(provider + ':sync')
    try {
      const result = await apiSend<{ skipped?: boolean; reason?: string; files?: { ok?: boolean }[] }>(
        `/api/ads/cloud-video/${provider}/sync`,
        'POST',
        { advertiserId },
      )
      if (result.skipped) toast.info(skipMessage(result.reason))
      else {
        const imported = (result.files ?? []).filter(file => file.ok).length
        toast.success(imported ? `${imported} criativo(s) sincronizado(s)` : 'Biblioteca já está atualizada')
        onSynced?.()
      }
      await mutate()
    } catch (err) {
      toast.error('Não foi possível sincronizar agora', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setWorking(null)
    }
  }

  async function disconnect(provider: ProviderKey) {
    setWorking(provider + ':disconnect')
    try {
      await apiSend(`/api/ads/cloud-video/${provider}`, 'DELETE')
      await mutate()
      toast.success('Integração desconectada')
    } catch (err) {
      toast.error('Não foi possível desconectar', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      setWorking(null)
    }
  }

  if (isLoading && !data) {
    return <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Conferindo nuvem…</div>
  }
  if (error || !data || !visibleProviders.length) return null

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-center gap-2">
        <Cloud className="size-3.5 text-muted-foreground" aria-hidden="true" />
        <p className="text-xs font-medium text-foreground">Sincronização automática</p>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">Novos vídeos da pasta entram na biblioteca automaticamente.</p>

      {safetyBlocked ? (
        <p className="mt-2 rounded-lg bg-warning/5 px-2.5 py-2 text-[11px] leading-relaxed text-warning">
          {data.safety.killSwitch ? 'Kill switch ativo.' : data.safety.dryRun ? 'Modo simulação ativo.' : 'Política de segurança desativada.'} A configuração é preservada, mas nenhum upload é enviado ao TikTok.
        </p>
      ) : null}

      <div className="mt-2 divide-y divide-border/50">
        {visibleProviders.map(({ key, label, placeholder }) => {
          const provider = data.providers[key]
          const busy = Boolean(working?.startsWith(key + ':'))
          const latest = data.activity.find(item => item.provider === key && (!provider.advertiserId || item.advertiser_id === provider.advertiserId))
          return (
            <div key={key} className="py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-foreground">{label}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {provider.connected ? provider.enabled ? 'Ativa' : 'Conectada · pausada' : 'Não conectada'}
                    {latest?.status === 'uploaded' ? ' · último arquivo sincronizado' : latest?.status === 'failed' ? ' · último envio falhou' : ''}
                  </p>
                </div>
                {!provider.connected ? (
                  <button type="button" className="btn-secondary h-9 shrink-0 text-xs" disabled={busy} onClick={() => void connect(key)}>
                    {busy && <Loader2 className="size-3.5 animate-spin" />}Conectar
                  </button>
                ) : null}
              </div>

              {provider.connected ? (
                <div className="mt-2">
                  <input
                    type="text"
                    className="h-9 w-full rounded-lg border border-border bg-background px-3 text-xs text-foreground outline-none focus:border-primary/60"
                    value={folders[key]}
                    placeholder={placeholder}
                    disabled={busy}
                    onChange={event => setFolders(current => ({ ...current, [key]: event.target.value }))}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <button type="button" className="btn-secondary h-9 text-xs" disabled={busy} onClick={() => void save(key, !provider.enabled)}>
                      {working === key + ':save' && <Loader2 className="size-3.5 animate-spin" />}
                      {provider.enabled ? 'Pausar' : 'Ativar'}
                    </button>
                    {provider.enabled ? (
                      <button type="button" className="btn-ghost h-9 text-xs" disabled={busy || safetyBlocked} onClick={() => void syncNow(key)}>
                        {working === key + ':sync' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                        Atualizar agora
                      </button>
                    ) : null}
                    <button type="button" className="btn-ghost h-9 text-xs text-muted-foreground" disabled={busy} onClick={() => void disconnect(key)}>
                      Desconectar
                    </button>
                  </div>
                  {latest?.error ? <p className="mt-2 text-[11px] text-error">{latest.error}</p> : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>
    </div>
  )
}
