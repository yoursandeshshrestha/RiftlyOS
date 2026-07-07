import { useEffect, useMemo, useState } from 'react'
import {
  RadialBar,
  RadialBarChart,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { formatMoney } from '@/lib/finance/money'
import { getChartTrackColor, getGaugeColor } from '@/lib/finance/chart-colors'

interface RevenueGaugeProps {
  current: number
  target: number | null
  currency: string
  onSetTarget?: () => void
}

export function RevenueGauge({ current, target, currency, onSetTarget }: RevenueGaugeProps) {
  const hasTarget = target != null && target > 0
  const pct = hasTarget ? Math.min(100, Math.round((current / target) * 100)) : 0

  const [trackColor, setTrackColor] = useState(getChartTrackColor())
  const [progressColor, setProgressColor] = useState(getGaugeColor(pct))

  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      setTrackColor(getChartTrackColor())
      setProgressColor(getGaugeColor(pct))
    }

    read()

    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [pct])

  const data = useMemo(
    () => [{ name: 'progress', value: pct, fill: progressColor }],
    [pct, progressColor],
  )

  return (
    <Card className="h-full">
      <CardEyebrow
        title="Revenue vs Target"
        description={hasTarget ? `${pct}% of monthly target` : 'No monthly target set'}
        action={
          onSetTarget ? (
            <Button variant="outline" size="xs" className="cursor-pointer" onClick={onSetTarget}>
              {hasTarget ? 'Edit target' : 'Set target'}
            </Button>
          ) : undefined
        }
      />

      <div className="relative">
        <ResponsiveContainer width="100%" height={180}>
          <RadialBarChart
            innerRadius="72%"
            outerRadius="100%"
            data={data}
            startAngle={90}
            endAngle={-270}
          >
            <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
            <RadialBar
              background={{ fill: trackColor }}
              dataKey="value"
              cornerRadius={10}
            />
          </RadialBarChart>
        </ResponsiveContainer>

        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center pt-2">
          <p className="text-2xl font-semibold tabular-nums">{hasTarget ? `${pct}%` : '—'}</p>
          <p className="text-[11px] text-muted-foreground">of target</p>
        </div>
      </div>

      <div className="px-4 pb-4 text-center">
        <p className="text-[13px] font-medium tabular-nums">
          {formatMoney(current, currency)}
          {hasTarget ? (
            <span className="text-muted-foreground"> / {formatMoney(target, currency)}</span>
          ) : (
            <span className="text-muted-foreground"> · MRR + one-off this month</span>
          )}
        </p>
        {hasTarget ? (
          <p className="mt-1 text-[12px] text-muted-foreground">
            {pct >= 100
              ? 'Target reached'
              : `${formatMoney(Math.max(target - current, 0), currency)} remaining`}
          </p>
        ) : null}
      </div>
    </Card>
  )
}
