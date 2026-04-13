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
}

export function DashboardLayout({ children, breadcrumbs }: DashboardLayoutProps) {
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
        />

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
