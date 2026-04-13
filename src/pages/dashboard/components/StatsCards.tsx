import { useEffect, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { FolderGit2, Users, CheckSquare, TrendingUp } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

interface StatCardProps {
  title: string
  value: string
  icon: React.ReactNode
  isLoading?: boolean
}

function StatCard({ title, value, icon, isLoading }: StatCardProps) {
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
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-semibold tracking-tight">{value}</div>
            )}
          </div>
        </div>
      </Card>
    </div>
  )
}

export function StatsCards() {
  const { activeWorkspace } = useWorkspace()
  const [stats, setStats] = useState({
    activeProjects: 0,
    teamMembers: 0,
    activeTasks: 0,
    totalRevenue: 0,
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

      // Fetch active projects count
      const { count: projectsCount } = await supabase
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', activeWorkspace.id)
        .eq('status', 'active')

      // Fetch team members count (owner + employees, exclude clients)
      const { count: membersCount } = await supabase
        .from('workspace_members')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', activeWorkspace.id)
        .in('role', ['owner', 'employee'])

      // Fetch active tasks count (not in "Done" column)
      const { data: columns } = await supabase
        .from('task_columns')
        .select('id, name')
        .eq('workspace_id', activeWorkspace.id)

      const doneColumn = columns?.find(col => col.name.toLowerCase() === 'done')

      const { count: tasksCount } = await supabase
        .from('tasks')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', activeWorkspace.id)
        .neq('column_id', doneColumn?.id || '')

      // Fetch total MRR from services
      const { data: services } = await supabase
        .from('services')
        .select('mrr')
        .eq('workspace_id', activeWorkspace.id)

      const totalMRR = services?.reduce((sum, service) => sum + Number(service.mrr), 0) || 0

      setStats({
        activeProjects: projectsCount || 0,
        teamMembers: membersCount || 0,
        activeTasks: tasksCount || 0,
        totalRevenue: totalMRR,
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
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const statsData = [
    {
      title: 'Active Projects',
      value: stats.activeProjects.toString(),
      icon: <FolderGit2 className="size-4" />,
    },
    {
      title: 'Team Members',
      value: stats.teamMembers.toString(),
      icon: <Users className="size-4" />,
    },
    {
      title: 'Active Tasks',
      value: stats.activeTasks.toString(),
      icon: <CheckSquare className="size-4" />,
    },
    {
      title: 'Monthly Revenue',
      value: formatCurrency(stats.totalRevenue),
      icon: <TrendingUp className="size-4" />,
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
