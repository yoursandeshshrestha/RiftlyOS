import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'

interface Project {
  id: string
  name: string
  client_name: string
  status: 'active' | 'paused' | 'completed'
  created_at: string
  services: { mrr: number }[]
}

const statusStyles = {
  active: 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/10',
  paused: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/10',
  completed: 'bg-gray-500/10 text-gray-700 dark:text-gray-400 hover:bg-gray-500/10',
}

export function RecentTransactions() {
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchRecentProjects()
    }
  }, [activeWorkspace?.id])

  const fetchRecentProjects = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      const { data: projectsData, error } = await supabase
        .from('projects')
        .select(`
          id,
          name,
          client_name,
          status,
          created_at,
          services (mrr)
        `)
        .eq('workspace_id', activeWorkspace.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (error) throw error

      setProjects(projectsData || [])
    } catch (error) {
      console.error('Error fetching recent projects:', error)
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

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const calculateTotalMRR = (project: Project) => {
    return (project.services || []).reduce((sum, service) => sum + Number(service.mrr), 0)
  }

  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Recent Projects
        </div>
      </div>
      <Card className="rounded-lg border py-0 ring-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">Project Name</TableHead>
              <TableHead className="text-[13px] font-medium">Client</TableHead>
              <TableHead className="text-[13px] font-medium">Status</TableHead>
              <TableHead className="text-[13px] font-medium">Services</TableHead>
              <TableHead className="text-[13px] font-medium">MRR</TableHead>
              <TableHead className="pr-6 text-[13px] font-medium">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                {[...Array(5)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <Skeleton className="h-[13px] w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[13px] w-32" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[18px] w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[13px] w-12" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[13px] w-20" />
                    </TableCell>
                    <TableCell className="pr-6">
                      <Skeleton className="h-[13px] w-24" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : projects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                  No projects found
                </TableCell>
              </TableRow>
            ) : (
              projects.map((project) => (
                <TableRow
                  key={project.id}
                  className="cursor-pointer"
                  onClick={() => navigate(`/projects/${project.id}`)}
                >
                  <TableCell className="pl-6 text-[13px] font-medium">{project.name}</TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {project.client_name}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[11px] capitalize ${statusStyles[project.status]}`}>
                      {project.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {project.services?.length || 0}
                  </TableCell>
                  <TableCell className="text-[13px] font-medium">
                    {formatCurrency(calculateTotalMRR(project))}
                  </TableCell>
                  <TableCell className="pr-6 text-[13px] text-muted-foreground">
                    {formatDate(project.created_at)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
