import { cn } from '@/lib/utils'

const authFooterLinkClassName =
  'text-muted-foreground underline transition-colors hover:text-foreground'

interface AuthLayoutProps {
  title: string
  subtitle: string
  children: React.ReactNode
  devActions?: React.ReactNode
  headerAction?: React.ReactNode
}

export function AuthLayout({
  title,
  subtitle,
  children,
  devActions,
  headerAction,
}: AuthLayoutProps) {
  return (
    <div className="relative flex min-h-dvh items-center justify-center overflow-y-auto bg-background">
      {devActions}
      {headerAction ? (
        <div className="absolute top-4 right-4 md:top-8 md:right-8">{headerAction}</div>
      ) : null}
      <div className="relative mx-auto flex min-h-dvh w-full max-w-md flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-7 p-4 pb-8 md:gap-8 md:p-8">
          <div className="flex w-full flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-medium md:text-3xl">{title}</h1>
            <p className="text-base text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex w-full flex-col gap-5">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function AuthDivider() {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-linear-to-r from-transparent to-border-subtle" />
      <span className="text-xs text-muted-foreground">or</span>
      <div className="h-px flex-1 bg-linear-to-l from-transparent to-border-subtle" />
    </div>
  )
}

export function AuthTextLink({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(authFooterLinkClassName, 'cursor-pointer text-sm', className)}
    >
      {children}
    </button>
  )
}
