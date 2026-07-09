import { MessagesIcon } from '@/components/icons'
import { cn } from '@/lib/utils'

interface TaskCommentCountProps {
  count?: number
  className?: string
}

export function TaskCommentCount({ count, className }: TaskCommentCountProps) {
  if (!count || count <= 0) return null

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-0.5 text-muted-foreground dark:text-gray-400',
        className,
      )}
      title={`${count} comment${count === 1 ? '' : 's'}`}
    >
      <MessagesIcon className="size-3" />
      <span className="text-[11px] font-medium tabular-nums">{count}</span>
    </span>
  )
}
