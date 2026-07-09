import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { formatDateTime } from '@/lib/date'
import { getTaskActivities } from '@/lib/tasks/comments'
import { useCallback, useEffect, useState } from 'react'
import type { TaskActivity, TaskActivityType } from '../types'
import { TaskLabelBadge } from './TaskLabelBadge'

interface TaskActivityFeedProps {
  taskId: string
  reloadKey?: number
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function activitySummary(activity: TaskActivity): React.ReactNode {
  const meta = activity.metadata ?? {}
  const actor = activity.actor?.full_name ?? 'Someone'

  switch (activity.activity_type as TaskActivityType) {
    case 'comment':
      return null
    case 'attachment_added':
      return (
        <>
          <span className="font-medium text-foreground">{actor}</span> attached{' '}
          {String(meta.file_name ?? 'a file')}
        </>
      )
    case 'attachment_removed':
      return (
        <>
          <span className="font-medium text-foreground">{actor}</span> removed{' '}
          {String(meta.file_name ?? 'a file')}
        </>
      )
    case 'label_added':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{actor}</span> added
          <TaskLabelBadge
            label={{
              name: String(meta.label_name ?? ''),
              color: String(meta.label_color ?? '#6366f1'),
            }}
          />
        </span>
      )
    case 'label_removed':
      return (
        <span className="inline-flex flex-wrap items-center gap-1.5">
          <span className="font-medium text-foreground">{actor}</span> removed
          <TaskLabelBadge
            label={{
              name: String(meta.label_name ?? ''),
              color: String(meta.label_color ?? '#6366f1'),
            }}
          />
        </span>
      )
    case 'status_changed':
      return (
        <>
          <span className="font-medium text-foreground">{actor}</span> moved status from{' '}
          {String(meta.from ?? '—')} to {String(meta.to ?? '—')}
        </>
      )
    case 'priority_changed':
      return (
        <>
          <span className="font-medium text-foreground">{actor}</span> changed priority from{' '}
          {String(meta.from ?? '—')} to {String(meta.to ?? '—')}
        </>
      )
    case 'assignee_changed':
      return <><span className="font-medium text-foreground">{actor}</span> updated assignees</>
    case 'due_date_changed':
      return (
        <>
          <span className="font-medium text-foreground">{actor}</span> changed due date from{' '}
          {String(meta.from ?? 'none')} to {String(meta.to ?? 'none')}
        </>
      )
    case 'created':
      return <><span className="font-medium text-foreground">{actor}</span> created this task</>
    default:
      return <><span className="font-medium text-foreground">{actor}</span> updated this task</>
  }
}

function FeedItem({ activity }: { activity: TaskActivity }) {
  const isComment = activity.activity_type === 'comment'

  if (isComment) {
    return (
      <li className="flex gap-3 py-3">
        <Avatar className="mt-0.5 size-6 shrink-0">
          <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
            {getInitials(activity.actor?.full_name ?? '?')}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-foreground">
              {activity.actor?.full_name ?? 'Unknown'}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDateTime(activity.created_at)}
            </span>
          </div>
          {activity.body && (
            <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {activity.body}
            </p>
          )}
        </div>
      </li>
    )
  }

  return (
    <li className="flex gap-3 py-2.5">
      <Avatar className="mt-0.5 size-6 shrink-0">
        <AvatarFallback className="bg-muted text-[9px] font-medium text-foreground">
          {getInitials(activity.actor?.full_name ?? '?')}
        </AvatarFallback>
      </Avatar>
      <p className="min-w-0 flex-1 pt-0.5 text-sm text-muted-foreground">
        {activitySummary(activity)}
        <span className="text-muted-foreground/60"> · {formatDateTime(activity.created_at)}</span>
      </p>
    </li>
  )
}

export function TaskActivityFeed({ taskId, reloadKey = 0 }: TaskActivityFeedProps) {
  const [activities, setActivities] = useState<TaskActivity[]>([])
  const [isLoading, setIsLoading] = useState(true)

  const load = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getTaskActivities(taskId)
      setActivities(
        data.filter(
          (a) => a.activity_type !== 'comment' || (a.body && a.body.trim().length > 0),
        ),
      )
    } catch (err) {
      console.error('Failed to load activity:', err)
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  if (isLoading) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
  }

  if (activities.length === 0) {
    return <p className="px-4 py-6 text-sm text-muted-foreground">No activity yet.</p>
  }

  return (
    <ul className="divide-y divide-border-table/60 px-4">
      {[...activities].reverse().map((activity) => (
        <FeedItem key={activity.id} activity={activity} />
      ))}
    </ul>
  )
}
