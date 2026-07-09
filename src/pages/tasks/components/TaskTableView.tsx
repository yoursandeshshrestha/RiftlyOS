import { Badge } from '@/components/ui/badge'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/date'
import { formatTimeVsEstimate } from '@/lib/time/format'
import { TASK_PRIORITIES, type Task, type TaskColumn } from '../types'
import type { TaskTableColumnKey } from '../taskViewSettings'
import { TaskLabelList } from './TaskLabelBadge'
import { TaskCommentCount } from './TaskCommentCount'

interface TaskTableViewProps {
  tasks: Task[]
  columns: TaskColumn[]
  visibleColumns: TaskTableColumnKey[]
  isLoading: boolean
  onTaskClick: (task: Task) => void
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function TaskTableView({
  tasks,
  columns,
  visibleColumns,
  isLoading,
  onTaskClick,
}: TaskTableViewProps) {
  const columnName = (columnId: string) =>
    columns.find((c) => c.id === columnId)?.name ?? '—'

  const show = (key: TaskTableColumnKey) => visibleColumns.includes(key)
  const colSpan = 1 + visibleColumns.length

  return (
    <Card variant="table">
      <CardEyebrow variant="table" title={`All Tasks (${tasks.length})`} />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6 text-[13px] font-medium">Title</TableHead>
            {show('status') && <TableHead className="text-[13px] font-medium">Status</TableHead>}
            {show('project') && <TableHead className="text-[13px] font-medium">Project</TableHead>}
            {show('priority') && <TableHead className="text-[13px] font-medium">Priority</TableHead>}
            {show('assignees') && <TableHead className="text-[13px] font-medium">Assignees</TableHead>}
            {show('labels') && <TableHead className="text-[13px] font-medium">Labels</TableHead>}
            {show('time') && <TableHead className="text-[13px] font-medium">Time</TableHead>}
            {show('due') && (
              <TableHead className="pr-6 text-[13px] font-medium">Due</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [...Array(6)].map((_, i) => (
              <TableRow key={i}>
                <TableCell className="pl-6">
                  <Skeleton className="h-[13px] w-48" />
                </TableCell>
                {visibleColumns.map((col) => (
                  <TableCell key={col} className={col === 'due' ? 'pr-6' : undefined}>
                    <Skeleton className="h-[13px] w-20" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : tasks.length === 0 ? (
            <TableRow>
              <TableCell colSpan={colSpan} className="h-24 text-center text-muted-foreground">
                No tasks found.
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => {
              const priorityConfig = TASK_PRIORITIES.find((p) => p.value === task.priority)
              const timeLabel = formatTimeVsEstimate(
                task.logged_minutes ?? 0,
                task.estimated_minutes,
              )
              return (
                <TableRow
                  key={task.id}
                  className="cursor-pointer"
                  onClick={() => onTaskClick(task)}
                >
                  <TableCell className="max-w-[280px] pl-6 text-[13px] font-medium">
                    <div className="flex items-start gap-2">
                      <span className="line-clamp-2 min-w-0 flex-1">{task.title}</span>
                      <TaskCommentCount count={task.comment_count} />
                    </div>
                  </TableCell>
                  {show('status') && (
                    <TableCell className="text-[13px] text-muted-foreground">
                      {columnName(task.column_id)}
                    </TableCell>
                  )}
                  {show('project') && (
                    <TableCell className="text-[13px] text-muted-foreground">
                      {task.project?.name ?? '—'}
                    </TableCell>
                  )}
                  {show('priority') && (
                    <TableCell>
                      {priorityConfig ? (
                        <Badge
                          variant="secondary"
                          className={`text-[11px] font-medium ${priorityConfig.color}`}
                        >
                          {priorityConfig.label}
                        </Badge>
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {show('assignees') && (
                    <TableCell>
                      {task.assignees && task.assignees.length > 0 ? (
                        <div className="flex -space-x-1.5">
                          {task.assignees.slice(0, 3).map((assignee) => (
                            <Avatar key={assignee.id} className="size-6 border-2 border-card">
                              <AvatarFallback className="bg-muted text-[9px] font-medium">
                                {getInitials(assignee.full_name)}
                              </AvatarFallback>
                            </Avatar>
                          ))}
                          {task.assignees.length > 3 && (
                            <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[9px] font-medium">
                              +{task.assignees.length - 3}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  {show('labels') && (
                    <TableCell>
                      {task.labels && task.labels.length > 0 ? (
                        <TaskLabelList labels={task.labels} max={2} />
                      ) : (
                        <span className="text-[13px] text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  )}
                  {show('time') && (
                    <TableCell className="text-[13px] text-muted-foreground">
                      {timeLabel ?? '—'}
                    </TableCell>
                  )}
                  {show('due') && (
                    <TableCell className="pr-6 text-[13px] text-muted-foreground">
                      {task.due_date ? formatDate(task.due_date) : '—'}
                    </TableCell>
                  )}
                </TableRow>
              )
            })
          )}
        </TableBody>
      </Table>
    </Card>
  )
}
