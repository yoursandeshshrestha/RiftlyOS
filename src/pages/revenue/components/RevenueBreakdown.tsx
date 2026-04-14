import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { PieChart as PieChartIcon } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import type { RevenueBreakdownItem } from '../types'

interface RevenueBreakdownProps {
  items: RevenueBreakdownItem[]
  isLoading: boolean
}

interface ChartDataItem {
  name: string
  value: number
  percentage: number
  color: string
}

export function RevenueBreakdown({ items, isLoading }: RevenueBreakdownProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value)
  }

  // Group items by source and calculate totals
  const serviceTotal = items
    .filter((item) => item.source === 'service')
    .reduce((sum, item) => sum + item.amount, 0)

  const dealTotal = items
    .filter((item) => item.source === 'deal')
    .reduce((sum, item) => sum + item.amount, 0)

  const manualTotal = items
    .filter((item) => item.source === 'manual')
    .reduce((sum, item) => sum + item.amount, 0)

  const total = serviceTotal + dealTotal + manualTotal

  const chartData: ChartDataItem[] = []

  if (serviceTotal > 0) {
    chartData.push({
      name: 'Services (MRR)',
      value: serviceTotal,
      percentage: Math.round((serviceTotal / total) * 100),
      color: '#3b82f6',
    })
  }

  if (dealTotal > 0) {
    chartData.push({
      name: 'Closed Deals',
      value: dealTotal,
      percentage: Math.round((dealTotal / total) * 100),
      color: '#10b981',
    })
  }

  if (manualTotal > 0) {
    chartData.push({
      name: 'Manual Entries',
      value: manualTotal,
      percentage: Math.round((manualTotal / total) * 100),
      color: '#8b5cf6',
    })
  }

  return (
    <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Revenue Breakdown
        </div>
        <div className="text-muted-foreground/40">
          <PieChartIcon className="size-4" />
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
              <h3 className="text-sm font-medium text-muted-foreground">Revenue by Source</h3>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(total)}</p>
            </div>
            {chartData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={chartData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'white',
                        border: '1px solid #e5e7eb',
                        borderRadius: '8px',
                        fontSize: '12px',
                      }}
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {chartData.map((item) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[13px] text-muted-foreground">{item.name}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-[13px] font-medium">{formatCurrency(item.value)}</span>
                        <span className="text-[13px] text-muted-foreground">{item.percentage}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No revenue data for this month
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
