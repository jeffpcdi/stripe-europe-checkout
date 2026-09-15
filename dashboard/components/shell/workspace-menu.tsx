'use client'

import { useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { useSWRConfig } from 'swr'
import { apiSend, useAccount, useAdsAccounts, useAdsStatus } from '@/lib/api'
import { toast } from '@/lib/toast'

/** Seleção confirmada pelo servidor, compartilhada com o contexto de anúncios. */
export function WorkspaceMenu() {
  const { data: account } = useAccount()
  const { data: status, error: statusError } = useAdsStatus()
  const { data, error, isLoading } = useAdsAccounts(Boolean(status?.connected))
  const { mutate } = useSWRConfig()
  const [switching, setSwitching] = useState(false)
  const lock = useRef(false)
  const selected = data?.accounts.find(item => String(item.id) === String(data.selected))
  const label = selected?.name || selected?.id || account?.name || 'Workspace'

  async function selectWorkspace(id: string) {
    if (lock.current || id === data?.selected) return
    lock.current = true
    setSwitching(true)
    try {
      const result = await apiSend<{ advertiserId: string }>('/api/ads/accounts/select', 'POST', { advertiserId: id })
      if (!result.advertiserId) throw new Error('A seleção da conta não foi confirmada.')
      await mutate('/api/ads/accounts', data ? { ...data, selected: result.advertiserId } : undefined, { revalidate: false })
      await mutate('/api/ads/status')
    } catch (err) {
      toast.error('Não foi possível trocar a conta', { hint: err instanceof Error ? err.message : undefined })
    } finally {
      lock.current = false
      setSwitching(false)
    }
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="premium-navbar__workspace-trigger" disabled={switching}
          aria-label={`Workspace: ${label}. Selecionar conta de anúncio`} aria-busy={switching}>
          <span>{switching ? 'Trocando conta…' : label}</span><ChevronDown size={13} aria-hidden="true" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={12} collisionPadding={12} className="premium-navbar-popup">
          <DropdownMenu.Label className="premium-navbar-popup__label">Contas de anúncio</DropdownMenu.Label>
          {error || statusError ? <p className="premium-navbar-popup__message">Não foi possível carregar as contas.</p>
            : isLoading ? <p className="premium-navbar-popup__message">Carregando contas…</p>
            : !data?.accounts.length ? <p className="premium-navbar-popup__message">Nenhuma conta conectada.</p> : null}
          <DropdownMenu.RadioGroup value={data?.selected || ''} onValueChange={selectWorkspace}>
            {data?.accounts.map(item => (
              <DropdownMenu.RadioItem key={item.id} value={item.id} disabled={switching} className="premium-navbar-popup__item">
                <span className="premium-navbar-popup__check"><DropdownMenu.ItemIndicator><Check size={14} /></DropdownMenu.ItemIndicator></span>
                <span className="truncate">{item.name || item.id}</span>
              </DropdownMenu.RadioItem>
            ))}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
