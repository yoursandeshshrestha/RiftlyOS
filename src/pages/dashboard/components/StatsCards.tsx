import { useEffect, useState } from 'react'
import { StatCard } from '@/components/ui/stat-card'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

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
    if (!activeWorkspace?.id) {
      setIsLoading(false)
      return
    }

    fetchStats()
  }, [activeWorkspace?.id])

  const fetchStats = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      const now = new Date()
      const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)

      const [
        projectsResult,
        prevProjectsResult,
        membersResult,
        prevMembersResult,
        columnsResult,
        servicesResult,
        prevServicesResult,
      ] = await Promise.all([
        supabase
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'active'),
        supabase
          .from('projects')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .eq('status', 'active')
          .lte('created_at', previousMonthEnd.toISOString()),
        supabase
          .from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['owner', 'employee']),
        supabase
          .from('workspace_members')
          .select('*', { count: 'exact', head: true })
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['owner', 'employee'])
          .lte('created_at', previousMonthEnd.toISOString()),
        supabase
          .from('task_columns')
          .select('id, name')
          .eq('workspace_id', activeWorkspace.id),
        supabase
          .from('services')
          .select('mrr, created_at')
          .eq('workspace_id', activeWorkspace.id),
        supabase
          .from('services')
          .select('mrr')
          .eq('workspace_id', activeWorkspace.id)
          .lte('created_at', previousMonthEnd.toISOString()),
      ])

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
      comparison: { changePercentage: stats.activeProjects.change },
    },
    {
      title: 'Team Members',
      value: stats.teamMembers.current.toString(),
      comparison: { changePercentage: stats.teamMembers.change },
    },
    {
      title: 'Active Tasks',
      value: stats.activeTasks.current.toString(),
      comparison: { changePercentage: stats.activeTasks.change },
    },
    {
      title: 'Monthly Revenue',
      value: formatCurrency(stats.totalRevenue.current),
      comparison: { changePercentage: stats.totalRevenue.change },
    },
  ]

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
      {statsData.map((stat) => (
        <StatCard key={stat.title} {...stat} isLoading={isLoading} />
      ))}
    </div>
  )
}
