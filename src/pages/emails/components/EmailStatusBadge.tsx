import { Badge } from '@/components/ui/badge'
import type { EmailDeliveryStatus } from '../types'

const STATUS_CONFIG: Record<
  EmailDeliveryStatus,
  { label: string; className: string }
> = {
  pending: {
    label: 'Pending',
    className: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20',
  },
  sent: {
    label: 'Sent',
    className: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20',
  },
  failed: {
    label: 'Failed',
    className: 'bg-red-500/10 text-red-700 dark:text-red-400 hover:bg-red-500/20',
  },
}

interface EmailStatusBadgeProps {
  status: EmailDeliveryStatus
}

export function EmailStatusBadge({ status }: EmailStatusBadgeProps) {
  const config = STATUS_CONFIG[status]
  return (
      <Badge variant="secondary" className={`text-[11px] font-medium ${config.className}`}>
      {config.label}
    </Badge>
  )
}
