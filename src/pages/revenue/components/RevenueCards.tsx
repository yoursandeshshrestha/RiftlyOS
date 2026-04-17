import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { TrendingUpIcon, EuroIcon, CoinsIcon, WalletIcon, ArrowUpIcon, ArrowDownIcon, InfoIcon } from '@/components/icons'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import type { RevenueMetrics } from '../types'

interface RevenueCardsProps {
  metrics: RevenueMetrics
  breakdown: {
    servicesMRR: number
    serviceIncomeEntries: number
    dealsIncome: number
    projectIncomeEntries: number
    otherIncomeEntries: number
  }
  isLoading: boolean
}

function StatCard({
  title,
  value,
  icon,
  isLoading,
  breakdown,
  comparison,
}: {
  title: string
  value: string
  icon: React.ReactNode
  isLoading?: boolean
  breakdown?: Array<{ label: string; amount: string }>
  comparison?: { changePercentage: number; prevValue: number; currentValue: number }
}) {
  const isPositive = comparison && comparison.changePercentage >= 0
  const isNeutral = comparison && comparison.changePercentage === 0

  const chartData = comparison
    ? [
        { name: 'Last Month', value: comparison.prevValue },
        { name: 'This Month', value: comparison.currentValue },
      ]
    : []

  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="flex items-center gap-1.5">
          <div className="text-[13px] font-medium text-muted-foreground/60">
            {title}
          </div>
          {breakdown && breakdown.length > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <InfoIcon className="size-3 cursor-pointer text-muted-foreground/40 hover:text-muted-foreground/60" />
                </TooltipTrigger>
                <TooltipContent side="right" className="max-w-[200px]">
                  <div className="space-y-1">
                    {breakdown.map((item, i) => (
                      <div key={i} className="flex items-center justify-between gap-4 text-xs">
                        <span className="text-muted-foreground">{item.label}</span>
                        <span className="font-medium">{item.amount}</span>
                      </div>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
        <div className="text-muted-foreground/40">{icon}</div>
      </div>
      <Card className="flex flex-col justify-between rounded-lg border px-4 pb-4 pt-6 ring-0">
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-2xl font-semibold tracking-tight">{value}</div>
                {comparison && !isNeutral && (
                  <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                    isPositive ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'
                  }`}>
                    {isPositive ? (
                      <ArrowUpIcon className="size-3" />
                    ) : (
                      <ArrowDownIcon className="size-3" />
                    )}
                    <span>{Math.abs(comparison.changePercentage).toFixed(1)}% from last month</span>
                  </div>
                )}
              </div>
              {comparison && chartData.length > 0 && (
                <div className="w-24">
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={chartData}>
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={isPositive ? '#10b981' : '#ef4444'}
                        fill={isPositive ? '#10b981' : '#ef4444'}
                        fillOpacity={0.2}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export function RevenueCards({ metrics, breakdown, isLoading }: RevenueCardsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const cards = [
    {
      title: 'Monthly Recurring Revenue',
      value: formatCurrency(metrics.totalMRR),
      icon: <TrendingUpIcon className="size-4" />,
      breakdown: [
        { label: 'Services MRR', amount: formatCurrency(breakdown.servicesMRR) },
        ...(breakdown.serviceIncomeEntries > 0
          ? [{ label: 'Manual (service)', amount: formatCurrency(breakdown.serviceIncomeEntries) }]
          : []),
      ],
      comparison: metrics.comparison
        ? {
            changePercentage: metrics.comparison.mrr.changePercentage,
            prevValue: metrics.comparison.mrr.prevValue,
            currentValue: metrics.comparison.mrr.currentValue,
          }
        : undefined,
    },
    {
      title: 'Project Income',
      value: formatCurrency(metrics.projectIncome),
      icon: <CoinsIcon className="size-4" />,
      breakdown: [
        { label: 'Closed Deals', amount: formatCurrency(breakdown.dealsIncome) },
        ...(breakdown.projectIncomeEntries > 0
          ? [{ label: 'Manual (project)', amount: formatCurrency(breakdown.projectIncomeEntries) }]
          : []),
      ],
      comparison: metrics.comparison
        ? {
            changePercentage: metrics.comparison.projectIncome.changePercentage,
            prevValue: metrics.comparison.projectIncome.prevValue,
            currentValue: metrics.comparison.projectIncome.currentValue,
          }
        : undefined,
    },
    {
      title: 'Other Income',
      value: formatCurrency(metrics.otherIncome),
      icon: <EuroIcon className="size-4" />,
      breakdown: [{ label: 'Manual (other)', amount: formatCurrency(breakdown.otherIncomeEntries) }],
      comparison: metrics.comparison
        ? {
            changePercentage: metrics.comparison.otherIncome.changePercentage,
            prevValue: metrics.comparison.otherIncome.prevValue,
            currentValue: metrics.comparison.otherIncome.currentValue,
          }
        : undefined,
    },
    {
      title: 'Total Revenue',
      value: formatCurrency(metrics.totalRevenue),
      icon: <WalletIcon className="size-4" />,
      comparison: metrics.comparison
        ? {
            changePercentage: metrics.comparison.totalRevenue.changePercentage,
            prevValue: metrics.comparison.totalRevenue.prevValue,
            currentValue: metrics.comparison.totalRevenue.currentValue,
          }
        : undefined,
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.title} {...card} isLoading={isLoading} />
      ))}
    </div>
  )
}
