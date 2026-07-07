import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { CalendarIcon, FolderOpenIcon, ProfileIcon } from '@/components/icons'
import { TASK_PRIORITIES } from '../types'
import type { Task } from '../types'
import { formatDate, formatDateTime } from '@/lib/date'

interface TaskDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  onEdit: () => void
  onDelete: () => void
}

export function TaskDetailsSheet({
  open,
  onOpenChange,
  task,
  onEdit,
  onDelete,
}: TaskDetailsSheetProps) {
  if (!task) return null

  const priorityConfig = TASK_PRIORITIES.find(p => p.value === task.priority)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Task Details</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6">
          {/* Task Name */}
          <div>
            <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Task Name</p>
            <h3 className="text-lg font-semibold text-foreground dark:text-gray-100">{task.title}</h3>
          </div>

          {/* Priority */}
          {priorityConfig && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Priority</p>
              <Badge variant="secondary" className={`text-xs font-medium ${priorityConfig.color}`}>
                {priorityConfig.label}
              </Badge>
            </div>
          )}

          {/* Description */}
          {task.description && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Description</p>
              <p className="text-sm leading-relaxed text-foreground dark:text-gray-100">
                {task.description}
              </p>
            </div>
          )}

          {/* Project */}
          {task.project && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-gray-300">
              <FolderOpenIcon className="size-4" />
              <span>Project:</span>
              <span className="font-semibold text-foreground dark:text-gray-100">{task.project.name}</span>
            </div>
          )}

          {/* Assignees */}
          {task.assignees && task.assignees.length > 0 && (
            <div className="flex items-start gap-2 text-sm text-muted-foreground dark:text-gray-300">
              <ProfileIcon className="size-4 mt-0.5" />
              <span>Assigned to:</span>
              <div className="flex flex-wrap gap-1">
                {task.assignees.map((assignee, index) => (
                  <span key={assignee.id} className="font-semibold text-foreground dark:text-gray-100">
                    {assignee.full_name}{index < task.assignees!.length - 1 ? ',' : ''}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Due Date */}
          {task.due_date && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-gray-300">
              <CalendarIcon className="size-4" />
              <span>Due:</span>
              <span className="font-semibold text-foreground dark:text-gray-100">{formatDate(task.due_date)}</span>
            </div>
          )}

          {/* Summary */}
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-muted-foreground dark:text-gray-300">
              Task was created on <span className="font-semibold text-foreground dark:text-gray-100">{formatDateTime(task.created_at)}</span>
              {task.assignees && task.assignees.length > 0 && (
                <>, assigned to <span className="font-semibold text-foreground dark:text-gray-100">
                  {task.assignees.map(a => a.full_name).join(', ')}
                </span></>
              )}
              {task.project && (
                <>, for project <span className="font-semibold text-foreground dark:text-gray-100">{task.project.name}</span></>
              )}.
            </p>
          </div>
        </div>

        <SheetFooter className="flex-row gap-3">
          <Button variant="outline" className="flex-1 cursor-pointer" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="destructive" className="flex-1 cursor-pointer" onClick={onDelete}>
            Delete
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
