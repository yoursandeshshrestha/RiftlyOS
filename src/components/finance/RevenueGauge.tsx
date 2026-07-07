import {
  RadialBar,
  RadialBarChart,
  PolarAngleAxis,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardEyebrow } from '@/components/ui/card'
import { formatMoney } from '@/lib/finance/money'

interface RevenueGaugeProps {
  current: number
  target: number
  currency: string
}

export function RevenueGauge({ current, target, currency }: RevenueGaugeProps) {
  const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0
  const data = [{ name: 'progress', value: pct, fill: 'hsl(var(--primary))' }]

  return (
    <Card className="h-full">
      <CardEyebrow
        title="Revenue vs Target"
        description={`${pct}% of target`}
      />
      <ResponsiveContainer width="100%" height={160}>
        <RadialBarChart
          innerRadius="70%"
          outerRadius="100%"
          data={data}
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
          <RadialBar background dataKey="value" cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="text-center">
        <p className="text-[13px] font-medium tabular-nums">
          {formatMoney(current, currency)}
          <span className="text-muted-foreground"> / {formatMoney(target, currency)}</span>
        </p>
      </div>
    </Card>
  )
}
