import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  MaximizeIcon,
  MinimizeIcon,
  MoonIcon,
  SunIcon,
} from '@/components/icons'
import { useThemeToggle } from '@/hooks/useThemeToggle'

interface AppearanceControlsProps {
  variant?: 'bezel' | 'header'
}

export function AppearanceControls({ variant = 'bezel' }: AppearanceControlsProps) {
  const { isDarkMode, toggleTheme } = useThemeToggle()
  const [isFullscreen, setIsFullscreen] = useState(false)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange)
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
    } else {
      document.exitFullscreen()
    }
  }

  const buttonClass =
    variant === 'bezel'
      ? 'size-9 cursor-pointer rounded-lg text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
      : 'size-8 cursor-pointer rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground'

  const activeClass =
    variant === 'bezel'
      ? 'bg-sidebar-accent text-sidebar-accent-foreground'
      : 'bg-accent text-accent-foreground'

  const containerClass =
    variant === 'bezel'
      ? 'flex flex-col items-center gap-1'
      : 'flex items-center gap-1'

  return (
    <div className={containerClass}>
      <Button
        variant="ghost"
        size="icon"
        onClick={toggleFullscreen}
        className={`${buttonClass} ${isFullscreen ? activeClass : ''}`}
        title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          <MaximizeIcon className="size-4" />
        ) : (
          <MinimizeIcon className="size-4" />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => void toggleTheme(e)}
        className={`${buttonClass} ${isDarkMode ? activeClass : ''}`}
        title={isDarkMode ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {isDarkMode ? (
          <MoonIcon className="size-4" />
        ) : (
          <SunIcon className="size-4" />
        )}
      </Button>
    </div>
  )
}
