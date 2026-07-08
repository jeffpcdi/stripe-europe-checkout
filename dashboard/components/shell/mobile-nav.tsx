'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import * as Dialog from '@radix-ui/react-dialog'
import { Menu, X } from 'lucide-react'
import { NAV_SECTIONS } from '@/lib/navigation'
import { cn } from '@/lib/utils'

export function MobileNav() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          className="glass flex size-9 items-center justify-center rounded-[10px] text-sub transition-colors hover:text-foreground lg:hidden"
          aria-label="Abrir menu de navegação"
        >
          <Menu className="size-4" aria-hidden="true" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-50 bg-black/60"
          style={{ animation: 'popBgIn var(--dur-fast) var(--ease) both' }}
        />
        <Dialog.Content
          className="glass glass-thick anim-pop-in fixed inset-y-3 left-3 z-50 flex w-64 flex-col overflow-y-auto p-4 focus:outline-none"
          aria-describedby={undefined}
        >
          <div className="mb-4 flex items-center justify-between px-2">
            <Dialog.Title className="text-sm font-semibold">Navegação</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className="flex size-8 items-center justify-center rounded-[10px] text-muted-foreground transition-colors hover:bg-[var(--hover)] hover:text-foreground"
                aria-label="Fechar menu"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>

          <nav className="flex flex-1 flex-col gap-5" aria-label="Navegação principal">
            {NAV_SECTIONS.map((section) => (
              <div key={section.title}>
                <p className="mb-1.5 px-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {section.title}
                </p>
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active =
                      item.href === '/'
                        ? pathname === '/'
                        : pathname.startsWith(item.href)
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => setOpen(false)}
                          aria-current={active ? 'page' : undefined}
                          className={cn(
                            'flex items-center gap-2.5 rounded-[10px] px-2 py-2 text-sm transition-colors duration-150',
                            active
                              ? 'bg-[var(--active)] text-foreground'
                              : 'text-sub hover:bg-[var(--hover)] hover:text-foreground',
                          )}
                        >
                          <item.icon
                            className={cn(
                              'size-4 shrink-0',
                              active ? 'text-brand-cyan' : 'text-muted-foreground',
                            )}
                            aria-hidden="true"
                          />
                          {item.label}
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </nav>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
