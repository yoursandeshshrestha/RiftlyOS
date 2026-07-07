import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertCircleIcon, RefreshIcon, HomeIcon } from '@/components/icons'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)

    this.setState({
      error,
      errorInfo,
    })

    // Log to error reporting service in production
    if (import.meta.env.PROD) {
      // TODO: Send to error tracking service (Sentry, LogRocket, etc.)
      // logErrorToService(error, errorInfo)
    }
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-4">
          <Card className="w-full max-w-2xl">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10">
                  <AlertCircleIcon className="size-6 text-destructive" />
                </div>
                <div>
                  <CardTitle className="text-2xl">Something went wrong</CardTitle>
                  <CardDescription>
                    An unexpected error occurred. Don't worry, your data is safe.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Error Message */}
              {this.state.error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 p-4">
                  <p className="text-sm font-medium text-destructive">
                    {this.state.error.message || 'Unknown error'}
                  </p>
                </div>
              )}

              {/* Stack Trace (Development Only) */}
              {import.meta.env.DEV && this.state.errorInfo && (
                <details className="rounded-md bg-muted p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    Technical Details (Development Only)
                  </summary>
                  <pre className="mt-3 max-h-64 overflow-auto text-xs">
                    {this.state.errorInfo.componentStack}
                  </pre>
                </details>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-2">
                <Button onClick={this.handleReset} className="cursor-pointer">
                  <RefreshIcon className="mr-2 size-4" />
                  Try Again
                </Button>
                <Button
                  onClick={this.handleReload}
                  variant="outline"
                  className="cursor-pointer"
                >
                  <RefreshIcon className="mr-2 size-4" />
                  Reload Page
                </Button>
                <Button
                  onClick={this.handleGoHome}
                  variant="outline"
                  className="cursor-pointer"
                >
                  <HomeIcon className="mr-2 size-4" />
                  Go to Home
                </Button>
              </div>

              {/* Help Text */}
              <div className="rounded-md bg-muted p-4">
                <p className="text-sm text-muted-foreground">
                  If this problem persists:
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>• Try clearing your browser cache and cookies</li>
                  <li>• Check your internet connection</li>
                  <li>• Contact support if the issue continues</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )
    }

    return this.props.children
  }
}
