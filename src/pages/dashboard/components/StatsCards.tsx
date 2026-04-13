import { Card } from '@/components/ui/card'
import { FolderGit2, Users, Rocket, AlertCircle } from 'lucide-react'
import { Area, AreaChart } from 'recharts'

interface StatCardProps {
  title: string
  value: string
  change: number
  icon: React.ReactNode
  data: number[]
}

function StatCard({ title, value, change, icon, data }: StatCardProps) {
  const isPositive = change >= 0
  const chartData = data.map((value, index) => ({ value, index }))

  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          {title}
        </div>
        <div className="text-muted-foreground/40">{icon}</div>
      </div>
      <Card className="rounded-lg border px-4 pb-4 pt-10 ring-0">
        <div className="flex items-end justify-between">
          <div>
            <div className="text-2xl font-semibold tracking-tight">{value}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              <span className={isPositive ? 'text-green-600' : 'text-red-600'}>
                {isPositive ? '+' : ''}{change}%
              </span>{' '}
              vs last week
            </div>
          </div>
          <div className="h-10 w-20">
            <AreaChart width={80} height={40} data={chartData}>
              <Area
                type="monotone"
                dataKey="value"
                stroke="#10b981"
                fill="#10b981"
                fillOpacity={0.2}
                strokeWidth={1.5}
              />
            </AreaChart>
          </div>
        </div>
      </Card>
    </div>
  )
}

export function StatsCards() {
  const stats = [
    {
      title: 'Active Projects',
      value: '12',
      change: 8.3,
      icon: <FolderGit2 className="size-4" />,
      data: [8, 9, 10, 11, 10, 11, 12],
    },
    {
      title: 'Team Members',
      value: '24',
      change: 12.5,
      icon: <Users className="size-4" />,
      data: [20, 21, 22, 23, 22, 23, 24],
    },
    {
      title: 'Deployments',
      value: '156',
      change: 15.2,
      icon: <Rocket className="size-4" />,
      data: [120, 130, 135, 140, 145, 150, 156],
    },
    {
      title: 'Open Tickets',
      value: '23',
      change: -18.4,
      icon: <AlertCircle className="size-4" />,
      data: [35, 32, 30, 28, 26, 24, 23],
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {stats.map((stat) => (
        <StatCard key={stat.title} {...stat} />
      ))}
    </div>
  )
}
