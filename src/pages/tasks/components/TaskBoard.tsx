import { TaskColumn } from './TaskColumn'
import { Skeleton } from '@/components/ui/skeleton'
import type { Task, TaskColumn as TaskColumnType } from '../types'

interface TaskBoardProps {
  columns: TaskColumnType[]
  tasks: Task[]
  isLoading?: boolean
  onRefresh: () => void
  onEditTask: (task: Task) => void
  onDragStart: (task: Task) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (columnId: string) => void
}

export function TaskBoard({
  columns,
  tasks,
  isLoading = false,
  onRefresh,
  onEditTask,
  onDragStart,
  onDragOver,
  onDrop
}: TaskBoardProps) {
  const getTasksForColumn = (columnId: string) => {
    return tasks.filter(task => task.column_id === columnId)
  }

  if (isLoading) {
    return (
      <>
        {[...Array(4)].map((_, i) => (
          <div key={i} className="flex w-[380px] shrink-0 flex-col rounded-xl border bg-muted/50 p-3">
            {/* Column Header */}
            <div className="mb-3 flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
            </div>

            {/* Tasks Container */}
            <div className="flex min-h-[160px] flex-col gap-2">
              {[...Array(2)].map((_, j) => (
                <div key={j} className="flex min-h-[140px] cursor-pointer flex-col space-y-2 rounded-xl border bg-card p-3">
                  {/* Task title */}
                  <Skeleton className="h-4 w-4/5" />

                  {/* Task description */}
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />

                  {/* Project */}
                  <Skeleton className="h-3 w-24" />

                  {/* Footer */}
                  <div className="mt-auto flex items-center gap-2 pt-1">
                    <Skeleton className="h-5 w-16 rounded-full" />
                    <Skeleton className="ml-auto size-6 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </>
    )
  }

  if (columns.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-12">
        <p className="text-sm text-muted-foreground">No task columns found</p>
        <p className="text-xs text-muted-foreground">Contact support to set up default columns</p>
      </div>
    )
  }

  return (
    <>
      {columns.map((column) => (
        <TaskColumn
          key={column.id}
          column={column}
          tasks={getTasksForColumn(column.id)}
          onRefresh={onRefresh}
          onEditTask={onEditTask}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDrop={() => onDrop(column.id)}
        />
      ))}
    </>
  )
}
