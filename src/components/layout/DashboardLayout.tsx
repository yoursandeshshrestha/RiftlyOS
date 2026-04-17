import { useState } from 'react'
import type { ReactNode } from 'react'
import { WorkspaceSidebar } from './WorkspaceSidebar'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

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

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <WorkspaceSidebar />
      <Sidebar isCollapsed={sidebarCollapsed} />

      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header
          breadcrumbs={breadcrumbs}
          onMenuClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          isSidebarCollapsed={sidebarCollapsed}
        />

        {/* Page Content */}
        <main className={`flex-1 overflow-y-auto ${noPadding ? '' : 'p-6'}`}>
          {children}
        </main>
      </div>
    </div>
  )
}
