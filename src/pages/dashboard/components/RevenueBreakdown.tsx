import { useEffect, useState } from 'react'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

interface RevenueData {
  name: string
  value: number
  percentage: number
  color: string
}

interface ProjectWithServices {
  id: string
  status: string
  services: { mrr: number }[]
}

export function RevenueBreakdown() {
  const { activeWorkspace } = useWorkspace()
  const [revenueData, setRevenueData] = useState<RevenueData[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setIsLoading(false)
      return
    }

    fetchRevenueBreakdown()
  }, [activeWorkspace?.id])

  const fetchRevenueBreakdown = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      const { data, error } = await supabase
        .from('projects')
        .select(`
          id,
          status,
          services (mrr)
        `)
        .eq('workspace_id', activeWorkspace.id)

      if (error) throw error

      const projects = (data || []) as unknown as ProjectWithServices[]

      const activeRevenue = projects
        .filter(p => p.status === 'active')
        .reduce((sum, p) => sum + (p.services || []).reduce((s: number, srv: { mrr: number }) => s + Number(srv.mrr), 0), 0)

      const pausedRevenue = projects
        .filter(p => p.status === 'paused')
        .reduce((sum, p) => sum + (p.services || []).reduce((s: number, srv: { mrr: number }) => s + Number(srv.mrr), 0), 0)

      const completedRevenue = projects
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + (p.services || []).reduce((s: number, srv: { mrr: number }) => s + Number(srv.mrr), 0), 0)

      const total = activeRevenue + pausedRevenue + completedRevenue

      const chartData: RevenueData[] = []

      if (activeRevenue > 0) {
        chartData.push({
          name: 'Active Projects',
          value: activeRevenue,
          percentage: Math.round((activeRevenue / total) * 100),
          color: '#10b981',
        })
      }

      if (pausedRevenue > 0) {
        chartData.push({
          name: 'Paused Projects',
          value: pausedRevenue,
          percentage: Math.round((pausedRevenue / total) * 100),
          color: '#f59e0b',
        })
      }

      if (completedRevenue > 0) {
        chartData.push({
          name: 'Completed Projects',
          value: completedRevenue,
          percentage: Math.round((completedRevenue / total) * 100),
          color: '#6b7280',
        })
      }

      setRevenueData(chartData)
      setTotalRevenue(total)
    } catch (error) {
      console.error('Error fetching revenue breakdown:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  return (
    <Card className="h-full min-h-0">
      <CardEyebrow
        title="Revenue Breakdown"
        description={isLoading ? undefined : formatCurrency(totalRevenue)}
      />
      {isLoading ? (
        <div className="flex min-h-[280px] flex-1 items-center justify-center">
          <Skeleton className="h-full w-full" />
        </div>
      ) : revenueData.length > 0 ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-[200px] flex-1 items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={revenueData}
                  cx="50%"
                  cy="50%"
                  innerRadius="58%"
                  outerRadius="82%"
                  paddingAngle={2}
                  dataKey="value"
                >
                  {revenueData.map((entry, index) => (
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
            {revenueData.map((item) => (
              <div key={item.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="size-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-[12px] text-muted-foreground">{item.name}</span>
                </div>
                <span className="text-[12px] text-foreground/80">{item.percentage}%</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted-foreground">
          No revenue data available
        </div>
      )}
    </Card>
  )
}
