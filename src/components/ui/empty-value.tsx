import { cn } from '@/lib/utils'

interface EmptyValueProps {
  className?: string
  label?: string
}

export function EmptyValue({ className, label = 'None' }: EmptyValueProps) {
  return (
    <span className={cn('text-muted-foreground', className)}>
      {label}
    </span>
  )
}
