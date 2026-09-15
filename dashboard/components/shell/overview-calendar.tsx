'use client'

import { CalendarDays, ChevronDown, Check } from 'lucide-react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { usePathname } from 'next/navigation'
import { useOverviewPeriod } from '@/lib/overview-period'
import { PERIODS } from '@/components/overview/period-picker'
import type { Period } from '@/lib/types'

export function OverviewCalendar() {
  const pathname = usePathname()
  const { period, setPeriod } = useOverviewPeriod()
  if (pathname !== '/') return null
  const label = PERIODS.find(item => item.id === period)?.label
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <button type="button" className="premium-navbar__calendar" aria-label={`Período da Visão geral: ${label}`}>
        <CalendarDays size={18} aria-hidden="true" /><span>{label}</span><ChevronDown size={14} aria-hidden="true" />
      </button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content align="end" sideOffset={12} collisionPadding={12} className="premium-navbar-popup premium-navbar-popup--calendar" aria-label="Calendário da Visão geral">
        <DropdownMenu.Label className="premium-navbar-popup__label">Período da Visão geral</DropdownMenu.Label>
        <DropdownMenu.RadioGroup value={period} onValueChange={value => setPeriod(value as Period)}>
          {PERIODS.map(item => <DropdownMenu.RadioItem key={item.id} value={item.id} className="premium-navbar-popup__item">
            <span className="premium-navbar-popup__check"><DropdownMenu.ItemIndicator><Check size={14} aria-hidden="true" /></DropdownMenu.ItemIndicator></span>{item.label}
          </DropdownMenu.RadioItem>)}
        </DropdownMenu.RadioGroup>
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>
}
