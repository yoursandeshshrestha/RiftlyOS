import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/contexts/AuthContext'
import { DevQuickLogin } from './components/DevQuickLogin'
import { LoginForm } from './components/LoginForm'
import { SocialLoginButtons } from './components/SocialLoginButtons'
import { HeroImage } from './components/HeroImage'

const DEV_USERS = [
  { role: 'Founder', email: 'founder@riftly.com', password: 'founder123' },
  { role: 'Client', email: 'client@riftly.com', password: 'client123' },
  { role: 'Employee', email: 'employee@riftly.com', password: 'employee123' },
] as const

export function LoginPage() {
  const { login, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [rememberMe, setRememberMe] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError('')

    try {
      await login(email, password)
      // Success - user will be redirected automatically by App.tsx
    } catch (err) {
      setError('Invalid email or password. Please try again.')
      console.error('Login error:', err)
    }
  }

  const handleDevLogin = async (devEmail: string, devPassword: string) => {
    setError('')
    try {
      await login(devEmail, devPassword)
    } catch (err) {
      setError('Dev login failed. Make sure seed data is loaded.')
      console.error('Dev login error:', err)
    }
  }

  const handleForgotPassword = () => {
    console.log('Forgot password clicked')
  }

  const handleGoogleLogin = () => {
    console.log('Google login')
  }

  return (
    <div className="flex h-screen">
      {/* Left Side - Login Form (2/5) */}
      <div className="flex w-2/5 items-center justify-center bg-background p-8">
        <div className="w-full max-w-md">
          {/* Login Card */}
          <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
            <div className="mb-2 px-1">
              <div className="text-2xl font-semibold tracking-tight">Sign in</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Enter your credentials to access your account
              </div>
            </div>
            <Card className="rounded-lg border ring-0">
              <CardContent className="pt-6">
                <div className="space-y-4">
                  {/* Dev Quick Login */}
                  <DevQuickLogin
                    devUsers={DEV_USERS}
                    onDevLogin={handleDevLogin}
                    isLoading={isLoading}
                  />

                  {/* Login Form */}
                  <LoginForm
                    email={email}
                    password={password}
                    rememberMe={rememberMe}
                    showPassword={showPassword}
                    error={error}
                    isLoading={isLoading}
                    onEmailChange={setEmail}
                    onPasswordChange={setPassword}
                    onRememberMeChange={setRememberMe}
                    onShowPasswordToggle={() => setShowPassword(!showPassword)}
                    onSubmit={handleSubmit}
                    onForgotPassword={handleForgotPassword}
                  />

                  {/* Social Login Buttons */}
                  <SocialLoginButtons onGoogleLogin={handleGoogleLogin} />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Footer */}
          <p className="mt-8 text-center text-xs text-muted-foreground">
            By signing in, you agree to our{' '}
            <a href="#" className="cursor-pointer underline hover:text-foreground">
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#" className="cursor-pointer underline hover:text-foreground">
              Privacy Policy
            </a>
          </p>
        </div>
      </div>

      {/* Right Side - Image (3/5) */}
      <HeroImage />
    </div>
  )
}
