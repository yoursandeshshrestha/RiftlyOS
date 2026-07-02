import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  MailIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ClockIcon,
} from '@/components/icons'

interface EmailStatsCardsProps {
  stats: {
    total: number
    sent: number
    failed: number
    pending: number
  }
  isLoading: boolean
}

function StatCard({
  title,
  value,
  icon,
  isLoading,
}: {
  title: string
  value: number
  icon: React.ReactNode
  isLoading?: boolean
}) {
  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">{title}</div>
        <div className="text-muted-foreground/40">{icon}</div>
      </div>
      <Card className="flex flex-col justify-between rounded-lg border px-4 pb-4 pt-6 ring-0">
        {isLoading ? (
          <Skeleton className="h-8 w-16" />
        ) : (
          <div className="text-2xl font-semibold tracking-tight">{value}</div>
        )}
      </Card>
    </div>
  )
}

export function EmailStatsCards({ stats, isLoading }: EmailStatsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard title="Total" value={stats.total} icon={<MailIcon className="size-4" />} isLoading={isLoading} />
      <StatCard title="Sent" value={stats.sent} icon={<CheckCircleIcon className="size-4" />} isLoading={isLoading} />
      <StatCard title="Failed" value={stats.failed} icon={<AlertCircleIcon className="size-4" />} isLoading={isLoading} />
      <StatCard title="Pending" value={stats.pending} icon={<ClockIcon className="size-4" />} isLoading={isLoading} />
    </div>
  )
}
