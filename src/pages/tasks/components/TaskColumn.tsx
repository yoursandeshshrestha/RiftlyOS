import { TaskCard } from './TaskCard'
import type { Task, TaskColumn as TaskColumnType } from '../types'

interface TaskColumnProps {
  column: TaskColumnType
  tasks: Task[]
  onRefresh: () => void
  onEditTask: (task: Task) => void
  onDragStart: (task: Task) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
}

export function TaskColumn({
  column,
  tasks,
  onRefresh,
  onEditTask,
  onDragStart,
  onDragOver,
  onDrop
}: TaskColumnProps) {
  return (
    <div
      className="flex w-[380px] shrink-0 flex-col rounded-xl border bg-muted/50 p-3"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Column Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground dark:text-gray-100">
          {column.name} ({tasks.length})
        </h3>
      </div>

      {/* Tasks Container */}
      <div className="flex min-h-[160px] flex-col gap-2">
        {tasks.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground dark:text-gray-400">
            No tasks
          </div>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onRefresh={onRefresh}
              onEdit={onEditTask}
              onDragStart={onDragStart}
            />
          ))
        )}
      </div>
    </div>
  )
}
