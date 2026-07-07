import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { DashboardPage } from '@/pages/dashboard'
import { UsersPage } from '@/pages/users'
import { DealsPage } from '@/pages/deals'
import { ProjectsPage } from '@/pages/projects'
import { ProjectDetailPage } from '@/pages/projects/ProjectDetailPage'
import { TasksPage } from '@/pages/tasks'
import { RevenuePage } from '@/pages/revenue'
import MessagesPage from '@/pages/messages'
import { EmailsPage } from '@/pages/emails'
import FinancePage from '@/pages/finance'
import InvoicesPage from '@/pages/finance/invoices'
import { LoginPage } from '@/pages/auth/LoginPage'
import { OnboardingPage } from '@/pages/auth/OnboardingPage'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider, useWorkspace } from '@/contexts/WorkspaceContext'
import { BrandLoader } from '@/components/BrandLoader'
import { ThemeProvider } from '@/components/ThemeProvider'
import { ThemeSync } from '@/components/ThemeSync'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, user, isLoading } = useAuth()

  if (isLoading) {
    return <BrandLoader />
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (user && !user.onboarding_completed) {
    return <Navigate to="/onboarding" replace />
  }

  return <>{children}</>
}

function OnboardingRoute({ children }: { children: React.ReactNode }) {
  const { session, user, isLoading } = useAuth()
  const { userRole } = useWorkspace()

  if (isLoading) {
    return <BrandLoader />
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (user && user.onboarding_completed) {
    // Redirect clients to /projects, others to /dashboard
    const redirectTo = userRole === 'client' ? '/projects' : '/dashboard'
    return <Navigate to={redirectTo} replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth()
  const { userRole } = useWorkspace()

  if (isLoading) {
    return <BrandLoader />
  }

  if (session) {
    // Redirect clients to /projects, others to /dashboard
    const redirectTo = userRole === 'client' ? '/projects' : '/dashboard'
    return <Navigate to={redirectTo} replace />
  }

  return <>{children}</>
}

function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <LoginPage />
          </PublicRoute>
        }
      />
      <Route
        path="/onboarding"
        element={
          <OnboardingRoute>
            <OnboardingPage />
          </OnboardingRoute>
        }
      />

      {/* Protected routes with persistent DashboardLayout */}
      <Route
        element={
          <ProtectedRoute>
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/users" element={<UsersPage />} />
        <Route path="/emails" element={<EmailsPage />} />
        <Route path="/pipeline" element={<DealsPage />} />
        <Route path="/projects" element={<ProjectsPage />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/revenue" element={<RevenuePage />} />
        <Route path="/finance" element={<FinancePage />} />
        <Route path="/finance/invoices" element={<InvoicesPage />} />
        <Route path="/messages" element={<MessagesPage />} />
      </Route>

      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <ThemeSync />
          <WorkspaceProvider>
            <AppRoutes />
          </WorkspaceProvider>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
