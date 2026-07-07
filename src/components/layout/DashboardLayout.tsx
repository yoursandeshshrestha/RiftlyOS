import { useState, useEffect } from 'react'
import { useLocation, Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
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
  breadcrumbs?: BreadcrumbItem[]
  noPadding?: boolean
}

export function DashboardLayout({ breadcrumbs, noPadding = false }: DashboardLayoutProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const location = useLocation()

  useEffect(() => {
    setMobileNavOpen(false)
  }, [location.pathname, location.hash])

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
    <div className="flex h-screen gap-0 bg-background">
      <div className="hidden h-full shrink-0 lg:flex">
        <Sidebar
          isCollapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((v) => !v)}
        />
      </div>

      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetContent
          side="left"
          className="h-full! w-56! max-w-[85vw]! gap-0 overflow-hidden bg-sidebar p-0 lg:hidden"
        >
          <SheetTitle className="sr-only">Navigation menu</SheetTitle>
          <SheetDescription className="sr-only">Navigation, channels and members</SheetDescription>
          <Sidebar className="h-full" />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <main className={`flex-1 overflow-y-auto ${location.pathname === '/messages' ? '' : 'p-5 sm:p-6'}`}>
          <Outlet />
        </main>
      </div>
    </div>
  )
}
