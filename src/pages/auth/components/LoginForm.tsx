import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon, AlertCircleIcon } from '@/components/icons'

interface LoginFormProps {
  email: string
  password: string
  rememberMe: boolean
  showPassword: boolean
  error: string
  isLoading: boolean
  onEmailChange: (email: string) => void
  onPasswordChange: (password: string) => void
  onRememberMeChange: (checked: boolean) => void
  onShowPasswordToggle: () => void
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void
  onForgotPassword: () => void
}

export function LoginForm({
  email,
  password,
  rememberMe,
  showPassword,
  error,
  isLoading,
  onEmailChange,
  onPasswordChange,
  onRememberMeChange,
  onShowPasswordToggle,
  onSubmit,
  onForgotPassword,
}: LoginFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircleIcon className="size-4 shrink-0 mt-0.5" />
          <p>{error}</p>
        </div>
      )}

      {/* Email Field */}
      <div className="space-y-2">
        <Label htmlFor="email" className="cursor-pointer">
          Email
        </Label>
        <div className="relative">
          <MailIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="email"
            type="email"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            className="pl-10"
            required
            autoComplete="email"
          />
        </div>
      </div>

      {/* Password Field - Only show if email is entered */}
      {email && (
        <div className="space-y-2">
          <Label htmlFor="password" className="cursor-pointer">
            Password
          </Label>
          <div className="relative">
            <LockIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              placeholder="Enter your password"
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              className="pl-10 pr-10"
              required
              autoComplete="current-password"
            />
            <button
              type="button"
              onClick={onShowPasswordToggle}
              className="absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
              tabIndex={-1}
            >
              {showPassword ? (
                <EyeOffIcon className="size-4" />
              ) : (
                <EyeIcon className="size-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* Remember Me & Forgot Password - Only show if password field is visible */}
      {email && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Checkbox
              id="remember"
              checked={rememberMe}
              onCheckedChange={(checked) => onRememberMeChange(checked === true)}
            />
            <Label
              htmlFor="remember"
              className="cursor-pointer text-sm font-normal"
            >
              Remember me
            </Label>
          </div>
          <a
            href="#"
            className="cursor-pointer text-sm font-medium text-primary hover:underline"
            onClick={(e) => {
              e.preventDefault()
              onForgotPassword()
            }}
          >
            Forgot password?
          </a>
        </div>
      )}

      {/* Submit Button */}
      <Button
        type="submit"
        className="w-full cursor-pointer"
        loading={isLoading}
        disabled={!email}
      >
        {isLoading ? 'Signing in...' : email && password ? 'Sign in' : 'Continue'}
      </Button>
    </form>
  )
}
