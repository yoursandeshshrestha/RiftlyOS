import { useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { Sidebar } from './Sidebar'
import { Header } from './Header'
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface DashboardLayoutProps {
  children: ReactNode
  breadcrumbs?: BreadcrumbItem[]
  noPadding?: boolean
}

export function DashboardLayout({ children, breadcrumbs, noPadding = false }: DashboardLayoutProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const location = useLocation()

  // Close the mobile drawer whenever the route or selected channel changes
  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, location.hash])

  // Close the mobile drawer when the viewport grows to desktop (lg+). The
  // SheetContent is hidden via `lg:hidden`, but the overlay backdrop is not,
  // so leaving the Sheet open on resize would leave a blurred backdrop stuck
  // over the screen.
  useEffect(() => {
    const mql = window.matchMedia('(min-width: 1024px)')
    const handleChange = () => {
      if (mql.matches) setMobileNavOpen(false)
    }
    handleChange()
    mql.addEventListener('change', handleChange)
    return () => mql.removeEventListener('change', handleChange)
  }, [])

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebars - inline on desktop */}
      <div className="hidden lg:flex">
        <WorkspaceSidebar />
        <Sidebar isCollapsed={sidebarCollapsed} />
      </div>

      {/* Sidebars - drawer on mobile/tablet */}
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[320px]! max-w-[90vw]! gap-0 overflow-hidden border-sidebar-border p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SheetDescription className="sr-only">
            Workspaces, navigation, channels and members
          </SheetDescription>
          <div className="flex h-full">
            <WorkspaceSidebar />
            <Sidebar isCollapsed={false} />
          </div>
        </SheetContent>
      </Sheet>

      {/* Main Content */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header
          breadcrumbs={breadcrumbs}
          onMenuClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          onMobileMenuClick={() => setMobileNavOpen(true)}
          isSidebarCollapsed={sidebarCollapsed}
        />

        {/* Page Content */}
        <main className={`flex-1 overflow-y-auto ${noPadding ? '' : 'p-4 sm:p-6'}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
