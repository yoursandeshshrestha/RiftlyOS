import { Card, CardEyebrow } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
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
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(value)
  }

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
    <Card className="h-full min-h-0">
      <CardEyebrow
        title="Revenue Breakdown"
        description={isLoading ? undefined : formatCurrency(total)}
      />
      {isLoading ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center">
          <Skeleton className="h-full w-full" />
        </div>
      ) : chartData.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-[200px] flex-1 items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="82%"
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
          </div>
          <div className="shrink-0 space-y-1.5 pt-2">
            {chartData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[12px] text-muted-foreground">{item.name}</span>
                </div>
                <div className="flex items-center gap-2 text-[12px]">
                  <span className="text-foreground/80">{formatCurrency(item.value)}</span>
                  <span className="text-muted-foreground">{item.percentage}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          No revenue data for this month
        </div>
      )}
    </Card>
  )
}
