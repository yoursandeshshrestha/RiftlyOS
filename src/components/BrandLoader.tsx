import { cn } from '@/lib/utils'
import { Spinner } from '@/components/ui/spinner'

interface BrandLoaderProps {
  fullScreen?: boolean
  className?: string
}

export function BrandLoader({
  fullScreen = true,
  className,
}: BrandLoaderProps) {
  const spinner = (
    <Spinner size="lg" className={cn('text-muted-foreground', className)} />
  )

  if (!fullScreen) {
    return spinner
  }

  return (
    <div className="flex h-screen w-full items-center justify-center bg-background">
      {spinner}
    </div>
  )
}
