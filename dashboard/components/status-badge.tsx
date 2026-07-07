import { cn } from '@/lib/utils'

type Status = 'success' | 'warning' | 'error' | 'info' | 'neutral'

const statusClass: Record<Status, string> = {
  success: 'bg-[var(--success-light)] text-success',
  warning: 'bg-[var(--warning-light)] text-warning',
  error: 'bg-[var(--error-light)] text-error',
  info: 'bg-[var(--accent-light)] text-brand-cyan',
  neutral: 'bg-[var(--hover)] text-muted-foreground',
}

export function StatusBadge({
  status = 'neutral',
  className,
  children,
}: {
  status?: Status
  className?: string
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium',
        statusClass[status],
        className,
      )}
    >
      {children}
    </span>
  )
}
