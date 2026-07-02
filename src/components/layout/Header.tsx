import { Button } from '@/components/ui/button'
import { MenuIcon } from '@/components/icons'
import { AppearanceControls } from './AppearanceControls'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[]
  onMobileMenuClick?: () => void
}

export function Header({
  breadcrumbs = [{ label: 'Dashboard' }],
  onMobileMenuClick,
}: HeaderProps) {
  const pageTitle = breadcrumbs[breadcrumbs.length - 1]?.label || 'Dashboard'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between bg-background px-5">
      <div className="flex min-w-0 items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onMobileMenuClick}
          className="shrink-0 cursor-pointer lg:hidden"
          title="Open menu"
        >
          <MenuIcon className="size-4" />
        </Button>
        <h1 className="truncate text-sm font-medium tracking-tight text-foreground">
          {pageTitle}
        </h1>
      </div>

      <AppearanceControls variant="header" />
    </header>
  )
}
