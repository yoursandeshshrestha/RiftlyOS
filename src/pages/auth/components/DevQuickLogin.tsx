interface DevUser {
  role: string
  email: string
  password: string
}

interface DevQuickLoginProps {
  devUsers: readonly DevUser[]
  onDevLogin: (email: string, password: string) => void
  isLoading: boolean
}

export function DevQuickLogin({ devUsers, onDevLogin, isLoading }: DevQuickLoginProps) {
  if (import.meta.env.VITE_ENVIRONMENT !== 'development') {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs font-medium text-muted-foreground">
          Quick Login
        </span>
        <div className="h-px flex-1 bg-border" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        {devUsers.map((user) => (
          <button
            key={user.role}
            type="button"
            onClick={() => onDevLogin(user.email, user.password)}
            disabled={isLoading}
            className="cursor-pointer rounded-lg border bg-background px-4 py-2.5 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {user.role}
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <div className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">or</span>
        <div className="h-px flex-1 bg-border" />
      </div>
    </div>
  )
}
