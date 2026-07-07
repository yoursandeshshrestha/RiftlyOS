import {
  Bar,
  BarChart,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { Card, CardEyebrow } from '@/components/ui/card'
import { formatMoney } from '@/lib/finance/money'

interface PaidOverdueChartProps {
  paid: number
  overdue: number
  currency: string
}

export function PaidOverdueChart({
  paid,
  overdue,
  currency,
}: PaidOverdueChartProps) {
  const data = [
    { name: 'Paid', amount: paid, fill: '#10b981' },
    { name: 'Overdue', amount: overdue, fill: '#ef4444' },
  ]

  return (
    <Card className="h-full">
      <CardEyebrow title="Paid vs Overdue" />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} barGap={8}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
          <XAxis
            dataKey="name"
            stroke="#9ca3af"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            dy={10}
          />
          <YAxis
            stroke="#9ca3af"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            dx={-10}
            tickFormatter={(v) => formatMoney(Number(v), currency)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(0, 0, 0, 0.05)' }}
            contentStyle={{
              backgroundColor: 'white',
              border: '1px solid #e5e7eb',
              borderRadius: '8px',
              fontSize: '12px',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
            formatter={(v) => formatMoney(Number(v), currency)}
          />
          <Bar dataKey="amount" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Card>
  )
}
