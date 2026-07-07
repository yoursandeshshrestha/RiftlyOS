import { StatCard } from '@/components/ui/stat-card'
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

export function RevenueCards({ metrics, breakdown, isLoading }: RevenueCardsProps) {
  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const cards = [
    {
      title: 'Monthly Recurring Revenue',
      value: formatCurrency(metrics.totalMRR),
      breakdown: [
        { label: 'Services MRR', amount: formatCurrency(breakdown.servicesMRR) },
        ...(breakdown.serviceIncomeEntries > 0
          ? [{ label: 'Manual (service)', amount: formatCurrency(breakdown.serviceIncomeEntries) }]
          : []),
      ],
      comparison: metrics.comparison
        ? { changePercentage: metrics.comparison.mrr.changePercentage }
        : undefined,
    },
    {
      title: 'Project Income',
      value: formatCurrency(metrics.projectIncome),
      breakdown: [
        { label: 'Closed Deals', amount: formatCurrency(breakdown.dealsIncome) },
        ...(breakdown.projectIncomeEntries > 0
          ? [{ label: 'Manual (project)', amount: formatCurrency(breakdown.projectIncomeEntries) }]
          : []),
      ],
      comparison: metrics.comparison
        ? { changePercentage: metrics.comparison.projectIncome.changePercentage }
        : undefined,
    },
    {
      title: 'Other Income',
      value: formatCurrency(metrics.otherIncome),
      breakdown: [{ label: 'Manual (other)', amount: formatCurrency(breakdown.otherIncomeEntries) }],
      comparison: metrics.comparison
        ? { changePercentage: metrics.comparison.otherIncome.changePercentage }
        : undefined,
    },
    {
      title: 'Total Revenue',
      value: formatCurrency(metrics.totalRevenue),
      comparison: metrics.comparison
        ? { changePercentage: metrics.comparison.totalRevenue.changePercentage }
        : undefined,
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {cards.map((card) => (
        <StatCard key={card.title} {...card} isLoading={isLoading} />
      ))}
    </div>
  )
}
