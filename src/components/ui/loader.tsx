import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

interface LoaderProps {
  className?: string
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = {
  sm: 'xs',
  md: 'md',
  lg: 'lg',
} as const

export function Loader({ className, size = 'sm' }: LoaderProps) {
  return <Spinner size={sizeMap[size]} className={cn(className)} />
}
