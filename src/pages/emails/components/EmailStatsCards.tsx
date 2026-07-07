import { StatCard } from '@/components/ui/stat-card'

interface EmailStatsCardsProps {
  stats: {
    total: number
    sent: number
    failed: number
    pending: number
  }
  isLoading: boolean
}

export function EmailStatsCards({ stats, isLoading }: EmailStatsCardsProps) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard title="Total" value={stats.total.toString()} isLoading={isLoading} />
      <StatCard title="Sent" value={stats.sent.toString()} isLoading={isLoading} />
      <StatCard title="Failed" value={stats.failed.toString()} isLoading={isLoading} />
      <StatCard title="Pending" value={stats.pending.toString()} isLoading={isLoading} />
    </div>
  )
}
