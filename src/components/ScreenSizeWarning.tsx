import { useEffect, useState } from 'react'
import { Monitor } from 'lucide-react'

const MIN_WIDTH = 1280

export function ScreenSizeWarning() {
  const [isSmallScreen, setIsSmallScreen] = useState(false)

  useEffect(() => {
    const checkScreenSize = () => {
      setIsSmallScreen(window.innerWidth < MIN_WIDTH)
    }

    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)

    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  if (!isSmallScreen) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-background">
      <div className="mx-4 max-w-md space-y-6 text-center">
        <div className="mx-auto flex size-20 items-center justify-center rounded-full bg-primary/10">
          <Monitor className="size-10 text-primary" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">
            Screen Size Too Small
          </h1>
          <p className="text-muted-foreground">
            This platform is optimized for larger screens only. Please use a device with a minimum width of {MIN_WIDTH}px for the best experience.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <p className="text-sm text-muted-foreground">
            Current screen width: <span className="font-mono font-semibold text-foreground">{typeof window !== 'undefined' ? window.innerWidth : 0}px</span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Required width: <span className="font-mono font-semibold text-foreground">{MIN_WIDTH}px</span>
          </p>
        </div>
      </div>
    </div>
  )
}
