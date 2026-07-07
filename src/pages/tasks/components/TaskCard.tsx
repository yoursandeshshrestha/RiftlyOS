import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { CalendarIcon, FolderOpenIcon } from '@/components/icons'
import { TASK_PRIORITIES } from '../types'
import type { Task } from '../types'
import { formatDate } from '@/lib/date'

interface TaskCardProps {
  task: Task
  onRefresh: () => void
  onEdit: (task: Task) => void
  onDragStart: (task: Task) => void
}

export function TaskCard({ task, onEdit, onDragStart }: TaskCardProps) {
  const priorityConfig = TASK_PRIORITIES.find(p => p.value === task.priority)

  const isDueSoon = (dueDate: string) => {
    const days = Math.ceil((new Date(dueDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    return days <= 3 && days >= 0
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div
      draggable
      onDragStart={() => onDragStart(task)}
      onClick={() => onEdit(task)}
      className="surface-card cursor-pointer rounded-md"
    >
      <div className="flex min-h-[140px] flex-col space-y-2">
        {/* Task title */}
        <h4 className="text-sm font-medium leading-tight text-foreground dark:text-gray-100">
          {task.title}
        </h4>

        {/* Task description */}
        {task.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground dark:text-gray-300">
            {task.description}
          </p>
        )}

        {/* Project */}
        {task.project && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground dark:text-gray-400">
            <FolderOpenIcon className="size-3 shrink-0" />
            <span className="truncate">{task.project.name}</span>
          </div>
        )}

        {/* Footer with badges and avatar */}
        <div className="mt-auto flex items-center gap-2 pt-1">
          {/* Priority badge */}
          {priorityConfig && (
            <Badge variant="secondary" className={`text-xs font-medium ${priorityConfig.color}`}>
              {priorityConfig.label}
            </Badge>
          )}

          {/* Due date */}
          {task.due_date && (
            <div className={`flex items-center gap-1 text-xs ${isDueSoon(task.due_date) ? 'text-orange-600 dark:text-orange-400' : 'text-muted-foreground dark:text-gray-400'}`}>
              <CalendarIcon className="size-3" />
              <span>Due: {formatDate(task.due_date)}</span>
            </div>
          )}

          {/* Assignee Avatars */}
          {task.assignees && task.assignees.length > 0 && (
            <div className="ml-auto flex -space-x-2">
              {task.assignees.slice(0, 3).map((assignee) => (
                <Avatar key={assignee.id} className="size-6 rounded-full border-2 border-card">
                  <AvatarFallback className="rounded-full bg-muted text-[10px] font-medium text-foreground">
                    {getInitials(assignee.full_name)}
                  </AvatarFallback>
                </Avatar>
              ))}
              {task.assignees.length > 3 && (
                <div className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[10px] font-medium text-foreground">
                  +{task.assignees.length - 3}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
