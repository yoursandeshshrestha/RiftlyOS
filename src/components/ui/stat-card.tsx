import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

interface StatCardProps {
  title: string
  value: string
  isLoading?: boolean
  comparison?: { changePercentage: number }
  breakdown?: Array<{ label: string; amount: string }>
  className?: string
}

export function StatCard({
  title,
  value,
  isLoading,
  comparison,
  breakdown,
  className,
}: StatCardProps) {
  const isPositive = comparison && comparison.changePercentage >= 0
  const isNeutral = comparison && comparison.changePercentage === 0

  return (
    <Card className={cn(className)}>
      <p className="text-[13px] text-muted-foreground">{title}</p>

      {isLoading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <div className="space-y-1">
          <p className="text-xl font-medium tracking-tight tabular-nums text-foreground">{value}</p>

          {comparison && !isNeutral && (
            <p
              className={cn(
                'text-[12px]',
                isPositive ? 'text-emerald-600/80 dark:text-emerald-500/80' : 'text-red-600/80 dark:text-red-500/80'
              )}
            >
              {isPositive ? '+' : '-'}
              {Math.abs(comparison.changePercentage).toFixed(1)}% vs last month
            </p>
          )}

          {breakdown && breakdown.length > 0 && (
            <div className="space-y-1 pt-2">
              {breakdown.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between gap-3 text-[12px] text-muted-foreground"
                >
                  <span>{item.label}</span>
                  <span className="tabular-nums text-foreground/80">{item.amount}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}
