import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { DashboardLayout } from '@/components/layout/DashboardLayout'
import { DashboardPage } from '@/pages/dashboard'
import { UsersPage } from '@/pages/users'
import { DealsPage } from '@/pages/deals'
import { LoginPage } from '@/pages/auth/LoginPage'
import { OnboardingPage } from '@/pages/auth/OnboardingPage'
import { AuthProvider, useAuth } from '@/contexts/AuthContext'
import { WorkspaceProvider } from '@/contexts/WorkspaceContext'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, user, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
      </div>
    )
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

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
      </div>
    )
  }

  if (!session) {
    return <Navigate to="/login" replace />
  }

  if (user && user.onboarding_completed) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const { session, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="inline-block size-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
      </div>
    )
  }

  if (session) {
    return <Navigate to="/dashboard" replace />
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
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <DashboardPage />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/users"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <UsersPage />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route
        path="/pipeline"
        element={
          <ProtectedRoute>
            <DashboardLayout>
              <DealsPage />
            </DashboardLayout>
          </ProtectedRoute>
        }
      />
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <WorkspaceProvider>
          <AppRoutes />
        </WorkspaceProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
