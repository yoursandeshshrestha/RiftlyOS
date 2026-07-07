import { useEffect, useMemo, useState } from 'react'
import {
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { Card, CardEyebrow } from '@/components/ui/card'
import { formatMoney } from '@/lib/finance/money'
import { getChartColor } from '@/lib/finance/chart-colors'

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
  const [colors, setColors] = useState({
    paid: getChartColor(1),
    overdue: getChartColor(5),
  })

  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      setColors({
        paid: getChartColor(1),
        overdue: getChartColor(5),
      })
    }

    read()

    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  const total = paid + overdue
  const data = useMemo(
    () =>
      [
        { name: 'Paid', value: paid, fill: colors.paid },
        { name: 'Overdue', value: overdue, fill: colors.overdue },
      ].filter((item) => item.value > 0),
    [colors.overdue, colors.paid, overdue, paid],
  )

  return (
    <Card className="h-full">
      <CardEyebrow
        title="Paid vs Overdue"
        description={
          total > 0
            ? `${Math.round((paid / total) * 100)}% collected this period`
            : 'No invoice activity yet'
        }
      />

      {total === 0 ? (
        <div className="flex h-[220px] items-center justify-center px-4 text-[13px] text-muted-foreground">
          Paid and overdue amounts will appear here once invoices are issued.
        </div>
      ) : (
        <div className="grid gap-4 px-2 pb-2 lg:grid-cols-[minmax(0,1fr)_160px] lg:items-center">
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={62}
                outerRadius={88}
                paddingAngle={data.length > 1 ? 3 : 0}
                stroke="transparent"
              >
                {data.map((entry) => (
                  <Cell key={entry.name} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => formatMoney(Number(value), currency)}
                contentStyle={{
                  backgroundColor: 'var(--popover)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  fontSize: '12px',
                  color: 'var(--foreground)',
                }}
              />
            </PieChart>
          </ResponsiveContainer>

          <div className="space-y-3 px-4 pb-4 lg:px-0 lg:pb-0">
            {data.map((item) => (
              <div key={item.name} className="flex items-start gap-2.5">
                <span
                  className="mt-1 size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: item.fill }}
                />
                <div className="min-w-0">
                  <p className="text-[12px] font-medium">{item.name}</p>
                  <p className="text-[13px] tabular-nums text-muted-foreground">
                    {formatMoney(item.value, currency)}
                  </p>
                </div>
              </div>
            ))}
            <div className="border-t border-border-table pt-3">
              <p className="text-[12px] text-muted-foreground">Total billed</p>
              <p className="text-[13px] font-medium tabular-nums">
                {formatMoney(total, currency)}
              </p>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
