import { cn } from '@/lib/utils'

type Status = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const statusClass: Record<Status, string> = {
  success: 'bg-[var(--success-light)] text-success ring-success/25',
  warning: 'bg-[var(--warning-light)] text-warning ring-warning/25',
  error: 'bg-[var(--error-light)] text-error ring-error/25',
  info: 'bg-[var(--accent-light)] text-brand-cyan ring-[color:var(--brand-cyan)]/25',
  neutral: 'bg-[var(--hover)] text-muted-foreground ring-border',
}

const dotClass: Record<Status, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  error: 'bg-error',
  info: 'bg-[color:var(--brand-cyan)]',
  neutral: 'bg-muted-foreground',
}

export function StatusBadge({
  status = 'neutral',
  dot = false,
  className,
  children,
}: {
  status?: Status
  dot?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'status-badge inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
        statusClass[status],
        className,
      )}
    >
      {dot ? (
        <span
          className={cn('size-1.5 shrink-0 rounded-full', dotClass[status])}
          aria-hidden="true"
        />
      ) : null}
      {children}
    </span>
  )
}
