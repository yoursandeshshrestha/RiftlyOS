import { Card, CardEyebrow } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import type { RevenueMetrics } from '../types'

interface RevenueProgressProps {
  metrics: RevenueMetrics
  isLoading: boolean
}

export function RevenueProgress({ metrics, isLoading }: RevenueProgressProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const progressPercentage = Math.min(metrics.progressPercentage, 100)
  const isOverTarget = metrics.progressPercentage > 100
  const remaining = Math.max(100 - progressPercentage, 0)

  const chartData = [
    { name: 'Achieved', value: progressPercentage },
    { name: 'Remaining', value: remaining },
  ]

  const COLORS = ['#3b82f6', 'oklch(0.5 0 0 / 0.15)']

  if (!metrics.targetAmount) {
    return (
      <Card className="h-full">
        <CardEyebrow title="Progress to Target" />
        <div className="flex flex-1 items-center justify-center py-8">
          <p className="text-[13px] text-muted-foreground">
            No target set for this month.
          </p>
        </div>
      </Card>
    )
  }

  return (
    <Card className="h-full">
      <CardEyebrow
        title="Progress to Target"
        description={formatCurrency(metrics.targetAmount)}
      />
      {isLoading ? (
        <div className="flex h-[260px] items-center justify-center">
          <Skeleton className="h-full w-full" />
        </div>
      ) : (
        <>
          <div className="relative">
            <ResponsiveContainer width="100%" height={160}>
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={52}
                  outerRadius={76}
                  startAngle={90}
                  endAngle={-270}
                  paddingAngle={0}
                  dataKey="value"
                >
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
              <div className="text-xl font-medium tabular-nums">{progressPercentage.toFixed(0)}%</div>
              <div className="text-[11px] text-muted-foreground">complete</div>
            </div>
          </div>

          <div className="space-y-1.5 text-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Current</span>
              <span className="tabular-nums text-foreground/80">{formatCurrency(metrics.totalRevenue)}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{isOverTarget ? 'Over target' : 'Remaining'}</span>
              <span className="tabular-nums text-foreground/80">
                {isOverTarget
                  ? `+${formatCurrency(metrics.totalRevenue - metrics.targetAmount)}`
                  : formatCurrency(metrics.targetAmount - metrics.totalRevenue)}
              </span>
            </div>
          </div>
        </>
      )}
    </Card>
  )
}
