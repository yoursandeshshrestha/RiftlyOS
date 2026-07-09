import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TaskLabel } from '../types'

export function TaskLabelBadge({
  label,
  className,
}: {
  label: Pick<TaskLabel, 'name' | 'color'>
  className?: string
}) {
  return (
    <Badge
      variant="secondary"
      className={cn('border-0 text-[11px] font-medium', className)}
      style={{
        backgroundColor: `${label.color}20`,
        color: label.color,
      }}
    >
      {label.name}
    </Badge>
  )
}

export function TaskLabelList({
  labels,
  max = 3,
  className,
}: {
  labels: TaskLabel[]
  max?: number
  className?: string
}) {
  if (!labels.length) return null

  const visible = labels.slice(0, max)
  const overflow = labels.length - visible.length

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {visible.map((label) => (
        <TaskLabelBadge key={label.id} label={label} />
      ))}
      {overflow > 0 && (
        <span className="text-[11px] text-muted-foreground">+{overflow}</span>
      )}
    </span>
  )
}
