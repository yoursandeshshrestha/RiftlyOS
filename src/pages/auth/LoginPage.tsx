import { useState } from 'react'
import { toast } from 'sonner'
import { ArrowRightIcon } from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
  authArrowSubmitButtonClassName,
  authInputClassName,
} from '@/components/auth/auth-styles'
import { AuthDivider, AuthLayout } from '@/pages/auth/AuthLayout'
import { SocialLoginButtons } from './components/SocialLoginButtons'

const DEV_USERS = [
  { role: 'Founder', email: 'founder@riftly.com', password: 'founder123' },
  { role: 'Client', email: 'client@riftly.com', password: 'client123' },
  { role: 'Employee', email: 'employee@riftly.com', password: 'employee123' },
] as const

function getLoginErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const authError = err as { code?: string; message?: string }
    if (
      authError.code === 'invalid_credentials' ||
      authError.message?.toLowerCase().includes('invalid login credentials')
    ) {
      return 'Invalid email or password. Please try again.'
    }
    if (authError.message) {
      return authError.message
    }
  }
  return 'Unable to sign in. Please try again.'
}

export function LoginPage() {
  const { login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const hasEmail = email.trim().length > 0
  const hasPassword = password.trim().length > 0
  const canSubmit = hasEmail && hasPassword

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!canSubmit || isSubmitting) return

    setIsSubmitting(true)

    try {
      await login(email, password)
    } catch (err) {
      toast.error(getLoginErrorMessage(err))
      console.error('Login error:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleDevLogin = async (devEmail: string, devPassword: string) => {
    setIsSubmitting(true)

    try {
      await login(devEmail, devPassword)
    } catch (err) {
      toast.error('Dev login failed. Make sure seed data is loaded.')
      console.error('Dev login error:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleGoogleLogin = () => {
    toast.message('Google sign-in is not configured yet.')
  }

  const devActions =
    import.meta.env.VITE_ENVIRONMENT === 'development' ? (
      <div className="absolute bottom-6 left-6 flex gap-3 text-xs text-muted-foreground">
        {DEV_USERS.map((user) => (
          <Button
            key={user.role}
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => handleDevLogin(user.email, user.password)}
            disabled={isSubmitting}
            className="h-auto cursor-pointer p-0 hover:text-foreground"
          >
            {user.role.toLowerCase()}
          </Button>
        ))}
      </div>
    ) : null

  return (
    <AuthLayout
      title="Sign in to Riftly"
      subtitle="Manage your workspace, projects, and team"
      devActions={devActions}
    >
      <SocialLoginButtons onGoogleLogin={handleGoogleLogin} disabled={isSubmitting} />

      <AuthDivider />

      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium">Continue with email</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <Input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={isSubmitting}
            autoComplete="email"
            className={authInputClassName}
          />
          <div className="relative">
            <Input
              type="password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              disabled={isSubmitting}
              autoComplete="current-password"
              className={cn(authInputClassName, canSubmit && 'pr-12')}
            />
            {canSubmit ? (
              <Button
                type="submit"
                variant="oauth"
                size="icon-sm"
                aria-label="Sign in"
                disabled={isSubmitting}
                loading={isSubmitting}
                className={authArrowSubmitButtonClassName}
              >
                <ArrowRightIcon className="size-4" />
              </Button>
            ) : null}
          </div>
        </form>
      </div>
    </AuthLayout>
  )
}
