import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Target } from 'lucide-react'
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
      currency: 'USD',
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

  const COLORS = ['#3b82f6', '#e5e7eb']

  if (!metrics.targetAmount) {
    return (
      <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
        <div className="mb-2 flex items-start justify-between px-1">
          <div className="text-[13px] font-medium text-muted-foreground/60">
            Progress to Target
          </div>
          <div className="text-muted-foreground/40">
            <Target className="size-4" />
          </div>
        </div>
        <Card className="flex flex-1 items-center justify-center rounded-lg border px-4 pb-6 pt-6 ring-0">
          <div className="flex items-center gap-3 text-muted-foreground">
            <Target className="size-5" />
            <p className="text-sm">
              No target set for this month. Click "Set Target" to add one.
            </p>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Progress to Target
        </div>
        <div className="text-muted-foreground/40">
          <Target className="size-4" />
        </div>
      </div>
      <Card className="flex-1 rounded-lg border px-4 pb-6 pt-6 ring-0">
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">Target Amount</h3>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(metrics.targetAmount)}</p>
            </div>

            {/* Chart */}
            <div className="relative">
              <ResponsiveContainer width="100%" height={180}>
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
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
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
                <div className="text-center">
                  <div className="text-3xl font-bold">{progressPercentage.toFixed(0)}%</div>
                  <div className="text-xs text-muted-foreground">Complete</div>
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="mt-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-blue-500" />
                  <span className="text-[13px] text-muted-foreground">Target Amount</span>
                </div>
                <span className="text-[13px] font-medium">{formatCurrency(metrics.targetAmount)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-emerald-500" />
                  <span className="text-[13px] text-muted-foreground">Current Revenue</span>
                </div>
                <span className="text-[13px] font-medium">{formatCurrency(metrics.totalRevenue)}</span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3 w-3 rounded-full bg-violet-500" />
                  <span className="text-[13px] text-muted-foreground">
                    {isOverTarget ? 'Over Target' : 'Remaining'}
                  </span>
                </div>
                <span className="text-[13px] font-medium">
                  {isOverTarget
                    ? `+${formatCurrency(metrics.totalRevenue - metrics.targetAmount)}`
                    : formatCurrency(metrics.targetAmount - metrics.totalRevenue)}
                </span>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
