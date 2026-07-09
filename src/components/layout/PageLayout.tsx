import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface PageLayoutProps {
  header: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

/** Standard page shell: sticky header band + scrollable body. Used inside DashboardLayout. */
export function PageLayout({
  header,
  children,
  className,
  contentClassName,
}: PageLayoutProps) {
  return (
    <div className={cn('min-h-full', className)}>
      <header className="sticky top-0 z-20 border-b border-border-table bg-background">
        <div className="px-5 py-3 sm:px-6">{header}</div>
      </header>
      <div className={cn('space-y-6 px-5 pb-6 pt-6 sm:px-6', contentClassName)}>
        {children}
      </div>
    </div>
  )
}
