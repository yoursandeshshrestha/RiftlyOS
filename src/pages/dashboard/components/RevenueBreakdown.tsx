import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { DollarSign } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

interface RevenueData {
  name: string
  value: number
  percentage: number
  color: string
}

export function RevenueBreakdown() {
  const { activeWorkspace } = useWorkspace()
  const [revenueData, setRevenueData] = useState<RevenueData[]>([])
  const [totalRevenue, setTotalRevenue] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchRevenueBreakdown()
    }
  }, [activeWorkspace?.id])

  const fetchRevenueBreakdown = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      // Fetch all projects with their services
      const { data: projects, error } = await supabase
        .from('projects')
        .select(`
          id,
          status,
          services (mrr)
        `)
        .eq('workspace_id', activeWorkspace.id)

      if (error) throw error

      // Calculate revenue by project status
      const activeRevenue = (projects || [])
        .filter(p => p.status === 'active')
        .reduce((sum, p) => sum + (p.services || []).reduce((s, srv) => s + Number(srv.mrr), 0), 0)

      const pausedRevenue = (projects || [])
        .filter(p => p.status === 'paused')
        .reduce((sum, p) => sum + (p.services || []).reduce((s, srv) => s + Number(srv.mrr), 0), 0)

      const completedRevenue = (projects || [])
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + (p.services || []).reduce((s, srv) => s + Number(srv.mrr), 0), 0)

      const total = activeRevenue + pausedRevenue + completedRevenue

      const data: RevenueData[] = []

      if (activeRevenue > 0) {
        data.push({
          name: 'Active Projects',
          value: activeRevenue,
          percentage: Math.round((activeRevenue / total) * 100),
          color: '#10b981',
        })
      }

      if (pausedRevenue > 0) {
        data.push({
          name: 'Paused Projects',
          value: pausedRevenue,
          percentage: Math.round((pausedRevenue / total) * 100),
          color: '#f59e0b',
        })
      }

      if (completedRevenue > 0) {
        data.push({
          name: 'Completed Projects',
          value: completedRevenue,
          percentage: Math.round((completedRevenue / total) * 100),
          color: '#6b7280',
        })
      }

      setRevenueData(data)
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
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value)
  }

  return (
    <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Revenue Breakdown
        </div>
        <div className="text-muted-foreground/40">
          <DollarSign className="size-4" />
        </div>
      </div>
      <Card className="flex-1 rounded-lg border px-4 pb-6 pt-6 ring-0">
        {isLoading ? (
          <div className="flex h-[320px] items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4">
              <h3 className="text-sm font-medium text-muted-foreground">Revenue by Status</h3>
              <p className="mt-1 text-2xl font-semibold">{formatCurrency(totalRevenue)}</p>
            </div>
            {revenueData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={revenueData}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={90}
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
                      formatter={(value: number) => formatCurrency(value)}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="mt-4 space-y-2">
                  {revenueData.map((item) => (
                    <div key={item.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="h-3 w-3 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-[13px] text-muted-foreground">{item.name}</span>
                      </div>
                      <span className="text-[13px] font-medium">{item.percentage}%</span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                No revenue data available
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  )
}
