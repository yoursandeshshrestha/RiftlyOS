import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { AlertCircleIcon } from '@/components/icons'
import type { Project } from '../types'

interface ProjectsGridProps {
  projects: Project[]
  isLoading: boolean
  onProjectClick: (project: Project) => void
  formatCurrency: (value: number) => string
}

export function ProjectsGrid({
  projects,
  isLoading,
  onProjectClick,
  formatCurrency,
}: ProjectsGridProps) {
  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/20'
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/20'
      case 'completed':
        return 'bg-gray-500/10 text-gray-700 dark:text-gray-400 hover:bg-gray-500/20'
      default:
        return ''
    }
  }

  const calculateTotalMRR = (project: Project) => {
    return (project.services || []).reduce((sum, service) => sum + Number(service.mrr), 0)
  }

  const getNextRenewal = (project: Project) => {
    if (!project.services || project.services.length === 0) return null

    const renewalDates = project.services
      .map(s => new Date(s.renewal_date))
      .sort((a, b) => a.getTime() - b.getTime())

    return renewalDates[0]
  }

  const isRenewalSoon = (renewalDate: Date | null) => {
    if (!renewalDate) return false
    const daysUntilRenewal = Math.ceil((renewalDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilRenewal <= 30 && daysUntilRenewal >= 0
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  if (isLoading) {
    return (
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {[...Array(6)].map((_, i) => (
          <Card key={i} className="gap-0 overflow-hidden p-0">
            <div className="p-4 pb-3">
              <Skeleton className="mb-2 h-5 w-16" />
              <Skeleton className="mb-2 h-5 w-3/4" />
              <Skeleton className="mb-4 h-4 w-1/2" />
              <Skeleton className="h-7 w-32" />
            </div>
            <div className="px-4 py-2.5">
              <Skeleton className="h-4 w-20" />
            </div>
          </Card>
        ))}
      </div>
    )
  }

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12">
        <p className="text-sm text-muted-foreground">No projects found</p>
        <p className="text-xs text-muted-foreground">Create your first project to get started</p>
      </div>
    )
  }

  return (
    <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {projects.map((project) => {
        const totalMRR = calculateTotalMRR(project)
        const showRenewalWarning = isRenewalSoon(getNextRenewal(project))

        return (
          <Card
            key={project.id}
            onClick={() => onProjectClick(project)}
            className="group relative cursor-pointer gap-0 overflow-hidden p-0 transition-colors hover:bg-muted/30"
          >
            {/* Main content area */}
            <div className="relative p-4 pb-3">
              {/* Status badge above name */}
              <div className="mb-2">
                <Badge
                  variant="secondary"
                  className={`text-xs ${getStatusColor(project.status)}`}
                >
                  {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
                </Badge>
              </div>

              {/* Project name */}
              <h3 className="mb-4 text-base font-semibold text-card-foreground">
                {project.name.length > 25 ? project.name.substring(0, 25) + '...' : project.name}
              </h3>

              {/* MRR amount */}
              <div className="mb-2">
                <span className="text-xl font-bold text-card-foreground">
                  {formatCurrency(totalMRR)}
                </span>
                <span className="ml-1 text-xs text-muted-foreground">/mo</span>
              </div>
            </div>

            {/* Folder icon on the right - half outside */}
            <div className="absolute -bottom-8 -right-8 h-32 w-32 opacity-40">
              <img
                src="/folder.png"
                alt=""
                className="h-full w-full object-contain"
              />
            </div>

            {/* Bottom info bar */}
            <div className="relative flex items-center justify-between px-4 py-2.5">
              <div className="flex items-center gap-3">
                {/* Services count */}
                <div className="flex items-center gap-1.5 text-muted-foreground">
                  <span className="text-xs font-medium">
                    {project.services?.length || 0} Services
                  </span>
                </div>

                {/* Project members */}
                {project.members && project.members.length > 0 && (
                  <div className="flex items-center gap-1">
                    {project.members.slice(0, 3).map((member) => (
                      <Avatar key={member.id} className="size-5 border border-background">
                        <AvatarFallback className="text-[9px] font-medium">
                          {member.profile ? getInitials(member.profile.full_name) : '?'}
                        </AvatarFallback>
                      </Avatar>
                    ))}
                    {project.members.length > 3 && (
                      <span className="text-xs text-muted-foreground">
                        +{project.members.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Warning indicator */}
              {showRenewalWarning && (
                <div className="flex items-center gap-1 rounded-full bg-orange-100 px-2 py-1 dark:bg-orange-900/30">
                  <AlertCircleIcon className="size-3 text-orange-600 dark:text-orange-400" />
                  <span className="text-xs font-medium text-orange-600 dark:text-orange-400">Soon</span>
                </div>
              )}
            </div>
          </Card>
        )
      })}
    </div>
  )
}
