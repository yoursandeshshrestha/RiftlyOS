import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { ProjectIcon, UsersIcon, TaskIcon, TrendingUpIcon, ArrowUpIcon, ArrowDownIcon } from '@/components/icons'
import { AreaChart, Area, ResponsiveContainer } from 'recharts'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

interface StatCardProps {
  title: string
  value: string
  icon: React.ReactNode
  isLoading?: boolean
  comparison?: { changePercentage: number; prevValue: number; currentValue: number }
}

function StatCard({ title, value, icon, isLoading, comparison }: StatCardProps) {
  const isPositive = comparison && comparison.changePercentage >= 0
  const isNeutral = comparison && comparison.changePercentage === 0

  const chartData = comparison
    ? [
        { name: 'Last Month', value: comparison.prevValue },
        { name: 'This Month', value: comparison.currentValue },
      ]
    : []

  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          {title}
        </div>
        <div className="text-muted-foreground/40">{icon}</div>
      </div>
      <Card className="flex flex-col justify-between rounded-lg border px-4 pb-4 pt-6 ring-0">
        {isLoading ? (
          <Skeleton className="h-8 w-24" />
        ) : (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="text-2xl font-semibold tracking-tight">{value}</div>
                {comparison && !isNeutral && (
                  <div className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                    isPositive ? 'text-emerald-600 dark:text-emerald-500' : 'text-red-600 dark:text-red-500'
                  }`}>
                    {isPositive ? (
                      <ArrowUpIcon className="size-3" />
                    ) : (
                      <ArrowDownIcon className="size-3" />
                    )}
                    <span>{Math.abs(comparison.changePercentage).toFixed(1)}% from last month</span>
                  </div>
                )}
              </div>
              {comparison && chartData.length > 0 && (
                <div className="w-24">
                  <ResponsiveContainer width="100%" height={60}>
                    <AreaChart data={chartData}>
                      <Area
                        type="monotone"
                        dataKey="value"
                        stroke={isPositive ? '#10b981' : '#ef4444'}
                        fill={isPositive ? '#10b981' : '#ef4444'}
                        fillOpacity={0.2}
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

export function StatsCards() {
  const { activeWorkspace } = useWorkspace()
  const [stats, setStats] = useState({
    activeProjects: { current: 0, previous: 0, change: 0 },
    teamMembers: { current: 0, previous: 0, change: 0 },
    activeTasks: { current: 0, previous: 0, change: 0 },
    totalRevenue: { current: 0, previous: 0, change: 0 },
  })
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchStats()
    }
  }, [activeWorkspace?.id])

  const fetchStats = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      // Calculate date ranges for current and previous month
      const now = new Date()
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

      // Fetch all data in parallel
      const [
        projectsResult,
        prevProjectsResult,
        membersResult,
        prevMembersResult,
        columnsResult,
        servicesResult,
        prevServicesResult,
      ] = await Promise.all([
        // Current active projects count
        supabase
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'active'),

        // Previous month active projects
        supabase
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'active')
          .lte('created_at', previousMonthEnd.toISOString()),

        // Current team members count
        supabase
          .from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['owner', 'employee']),

        // Previous month team members
        supabase
          .from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['owner', 'employee'])
          .lte('created_at', previousMonthEnd.toISOString()),

        // Task columns
        supabase
          .from('task_columns')
          .select('id, name')
          .eq('workspace_id', activeWorkspace.id),

        // Current services MRR
        supabase
          .from('services')
          .select('mrr, created_at')
          .eq('workspace_id', activeWorkspace.id),

        // Previous month services MRR
        supabase
          .from('services')
          .select('mrr')
          .eq('workspace_id', activeWorkspace.id)
          .lte('created_at', previousMonthEnd.toISOString()),
      ])

      // Find done column and fetch current/previous tasks count
      const doneColumn = (columnsResult.data as { id: string; name: string }[] | null)?.find(
        col => col.name.toLowerCase() === 'done'
      )

      const [currentTasksResult, prevTasksResult] = await Promise.all([
        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .neq('column_id', doneColumn?.id || ''),

        supabase
          .from('tasks')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .neq('column_id', doneColumn?.id || '')
          .lte('created_at', previousMonthEnd.toISOString()),
      ])

      const currentMRR = (servicesResult.data as { mrr: number }[] | null)?.reduce(
        (sum, service) => sum + Number(service.mrr),
        0
      ) || 0

      const prevMRR = (prevServicesResult.data as { mrr: number }[] | null)?.reduce(
        (sum, service) => sum + Number(service.mrr),
        0
      ) || 0

      const currentProjects = projectsResult.count || 0
      const prevProjects = prevProjectsResult.count || 0
      const currentMembers = membersResult.count || 0
      const prevMembers = prevMembersResult.count || 0
      const currentTasks = currentTasksResult.count || 0
      const prevTasks = prevTasksResult.count || 0

      setStats({
        activeProjects: {
          current: currentProjects,
          previous: prevProjects,
          change: prevProjects > 0 ? ((currentProjects - prevProjects) / prevProjects) * 100 : 0,
        },
        teamMembers: {
          current: currentMembers,
          previous: prevMembers,
          change: prevMembers > 0 ? ((currentMembers - prevMembers) / prevMembers) * 100 : 0,
        },
        activeTasks: {
          current: currentTasks,
          previous: prevTasks,
          change: prevTasks > 0 ? ((currentTasks - prevTasks) / prevTasks) * 100 : 0,
        },
        totalRevenue: {
          current: currentMRR,
          previous: prevMRR,
          change: prevMRR > 0 ? ((currentMRR - prevMRR) / prevMRR) * 100 : 0,
        },
      })
    } catch (error) {
      console.error('Error fetching stats:', error)
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

  const statsData = [
    {
      title: 'Active Projects',
      value: stats.activeProjects.current.toString(),
      icon: <ProjectIcon className="size-4" />,
      comparison: {
        changePercentage: stats.activeProjects.change,
        prevValue: stats.activeProjects.previous,
        currentValue: stats.activeProjects.current,
      },
    },
    {
      title: 'Team Members',
      value: stats.teamMembers.current.toString(),
      icon: <UsersIcon className="size-4" />,
      comparison: {
        changePercentage: stats.teamMembers.change,
        prevValue: stats.teamMembers.previous,
        currentValue: stats.teamMembers.current,
      },
    },
    {
      title: 'Active Tasks',
      value: stats.activeTasks.current.toString(),
      icon: <TaskIcon className="size-4" />,
      comparison: {
        changePercentage: stats.activeTasks.change,
        prevValue: stats.activeTasks.previous,
        currentValue: stats.activeTasks.current,
      },
    },
    {
      title: 'Monthly Revenue',
      value: formatCurrency(stats.totalRevenue.current),
      icon: <TrendingUpIcon className="size-4" />,
      comparison: {
        changePercentage: stats.totalRevenue.change,
        prevValue: stats.totalRevenue.previous,
        currentValue: stats.totalRevenue.current,
      },
    },
  ]

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {statsData.map((stat) => (
        <StatCard key={stat.title} {...stat} isLoading={isLoading} />
      ))}
    </div>
  )
}
