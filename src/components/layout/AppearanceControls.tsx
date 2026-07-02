import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  MaximizeIcon,
  MinimizeIcon,
  MoonIcon,
  SunIcon,
} from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface AppearanceControlsProps {
  variant?: 'bezel' | 'header'
}

export function AppearanceControls({ variant = 'bezel' }: AppearanceControlsProps) {
  const { user } = useAuth()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    if (user?.theme) {
      const shouldBeDark =
        user.theme === 'dark' ||
        (user.theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

      if (shouldBeDark) {
        document.documentElement.classList.add('dark')
        setIsDarkMode(true)
      } else {
        document.documentElement.classList.remove('dark')
        setIsDarkMode(false)
      }
    }
  }, [user?.theme])

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

  const toggleDarkMode = async (e: React.MouseEvent) => {
    const newTheme = isDarkMode ? 'light' : 'dark'
    const root = document.documentElement

    if (!document.startViewTransition) {
      if (isDarkMode) {
        root.classList.remove('dark')
        setIsDarkMode(false)
      } else {
        root.classList.add('dark')
        setIsDarkMode(true)
      }
    } else {
      root.style.setProperty('--x', `${e.clientX}px`)
      root.style.setProperty('--y', `${e.clientY}px`)

      document.startViewTransition(() => {
        if (isDarkMode) {
          root.classList.remove('dark')
          setIsDarkMode(false)
        } else {
          root.classList.add('dark')
          setIsDarkMode(true)
        }
      })
    }

    if (user?.id) {
      try {
        const { error } = await supabase
          .from('profiles')
          .update({ theme: newTheme } as never)
          .eq('id', user.id)

        if (error) {
          console.error('Error saving theme preference:', error)
        }
      } catch (error) {
        console.error('Error saving theme preference:', error)
      }
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
        onClick={(e) => toggleDarkMode(e)}
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
