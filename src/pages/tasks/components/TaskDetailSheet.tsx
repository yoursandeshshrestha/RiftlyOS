import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { Task, TaskColumn } from '../types'
import { TaskDetailPanel } from './TaskDetailPanel'

interface TaskDetailSheetProps {
  open: boolean
  task: Task | null
  columns: TaskColumn[]
  onOpenChange: (open: boolean) => void
  onDelete: () => void
  onTaskUpdate: (task: Task) => void
  onTimerChange?: () => void
  onActivityChange?: () => void
}

export function TaskDetailSheet({
  open,
  task,
  columns,
  onOpenChange,
  onDelete,
  onTaskUpdate,
  onTimerChange,
  onActivityChange,
}: TaskDetailSheetProps) {
  if (!task) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className={cn(
          'gap-0 overflow-hidden p-0',
          'data-[side=right]:!w-full data-[side=right]:sm:!w-[720px] data-[side=right]:sm:!max-w-[720px]',
        )}
      >
        <SheetTitle className="sr-only">Task Details</SheetTitle>
        <TaskDetailPanel
          task={task}
          columns={columns}
          onClose={() => onOpenChange(false)}
          onDelete={onDelete}
          onTaskUpdate={onTaskUpdate}
          onTimerChange={onTimerChange}
          onActivityChange={onActivityChange}
        />
      </SheetContent>
    </Sheet>
  )
}
