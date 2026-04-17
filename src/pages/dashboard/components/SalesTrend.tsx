import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { TrendingUpIcon } from '@/components/icons'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

const tabs = ['6 Months', '12 Months']

export function SalesTrend() {
  const { activeWorkspace } = useWorkspace()
  const [activeTab, setActiveTab] = useState('6 Months')
  const [chartData, setChartData] = useState<{ month: string; projects: number; tasks: number }[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchTrendData()
    }
  }, [activeWorkspace?.id, activeTab])

  const fetchTrendData = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      const months = activeTab === '6 Months' ? 6 : 12

      // Build array of month queries to run in parallel
      const monthQueries = Array.from({ length: months }, (_, i) => {
        const date = new Date()
        date.setMonth(date.getMonth() - (months - 1 - i))
        const monthStart = new Date(date.getFullYear(), date.getMonth(), 1)
        const monthEnd = new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59)

        return {
          date,
          projectsQuery: supabase
            .from('projects')
            .select('*', { count: 'exact', head: true })
            .eq('workspace_id', activeWorkspace.id)
            .gte('created_at', monthStart.toISOString())
            .lte('created_at', monthEnd.toISOString()),
          tasksQuery: supabase
            .from('tasks')
            .select('*', { count: 'exact', head: true })
            .eq('workspace_id', activeWorkspace.id)
            .gte('created_at', monthStart.toISOString())
            .lte('created_at', monthEnd.toISOString()),
        }
      })

      // Execute all queries in parallel
      const results = await Promise.all(
        monthQueries.map(async ({ date, projectsQuery, tasksQuery }) => {
          const [projectsResult, tasksResult] = await Promise.all([projectsQuery, tasksQuery])
          return {
            month: date.toLocaleDateString('en-US', { month: 'short' }),
            projects: projectsResult.count || 0,
            tasks: tasksResult.count || 0,
          }
        })
      )

      setChartData(results)
    } catch (error) {
      console.error('Error fetching trend data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const totalProjects = chartData.reduce((sum, d) => sum + d.projects, 0)
  const totalTasks = chartData.reduce((sum, d) => sum + d.tasks, 0)

  return (
    <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Activity Trend
        </div>
        <div className="text-muted-foreground/40">
          <TrendingUpIcon className="size-4" />
        </div>
      </div>
      <Card className="flex-1 rounded-lg border px-6 pb-6 pt-6 ring-0">
        {isLoading ? (
          <div className="flex h-[380px] items-center justify-center">
            <Skeleton className="h-full w-full" />
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <h3 className="text-base font-medium text-muted-foreground">
                  Total Activity: <span className="text-foreground">{totalProjects + totalTasks}</span>
                </h3>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                    <span className="text-[12px] text-muted-foreground">PROJECTS</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    <span className="text-[12px] text-muted-foreground">TASKS</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-1 rounded-md bg-muted/50 p-1">
                {tabs.map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`cursor-pointer rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                      activeTab === tab
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>
            </div>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={chartData} barGap={4}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
                <XAxis
                  dataKey="month"
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
                  tickFormatter={(value) => `${value}`}
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
                  labelStyle={{ fontWeight: 600, marginBottom: '4px' }}
                />
                <Bar dataKey="projects" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                <Bar dataKey="tasks" fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </Card>
    </div>
  )
}
