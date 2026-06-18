import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import {
  MaximizeIcon,
  MinimizeIcon,
  MoonIcon,
  SunIcon,
  ProfileIcon,
  PanelLeftIcon,
  PanelRightIcon,
  MenuIcon,
} from '@/components/icons'
import { ProfileDropdown } from './ProfileDropdown'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'

interface BreadcrumbItem {
  label: string
  href?: string
}

interface HeaderProps {
  breadcrumbs?: BreadcrumbItem[]
  onMenuClick?: () => void
  onMobileMenuClick?: () => void
  isSidebarCollapsed?: boolean
}

export function Header({ breadcrumbs = [{ label: 'Dashboard' }], onMenuClick, onMobileMenuClick, isSidebarCollapsed = false }: HeaderProps) {
  const { user } = useAuth()
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isDarkMode, setIsDarkMode] = useState(false)

  useEffect(() => {
    // Apply theme from user profile on mount
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

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } else {
      document.exitFullscreen()
      setIsFullscreen(false)
    }
  }

  const toggleDarkMode = async (e: React.MouseEvent) => {
    const newTheme = isDarkMode ? 'light' : 'dark'
    const root = document.documentElement

    // Check if View Transition API is supported
    if (!document.startViewTransition) {
      // Fallback for browsers that don't support View Transitions
      if (isDarkMode) {
        root.classList.remove('dark')
        setIsDarkMode(false)
      } else {
        root.classList.add('dark')
        setIsDarkMode(true)
      }
    } else {
      // Set coordinates from click event for circular reveal animation
      root.style.setProperty('--x', `${e.clientX}px`)
      root.style.setProperty('--y', `${e.clientY}px`)

      // Use View Transition API for smooth animation
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

    // Save to database
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

  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      {/* Left Section: Sidebar Toggle + Breadcrumbs */}
      <div className="flex min-w-0 items-center gap-3">
        {/* Mobile menu - opens the navigation drawer (mobile/tablet only) */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMobileMenuClick}
          className="shrink-0 cursor-pointer lg:hidden"
          title="Open menu"
        >
          <MenuIcon className="size-4" />
        </Button>
        {/* Sidebar Toggle - desktop only, shows current state */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className={`hidden shrink-0 cursor-pointer transition-colors lg:inline-flex ${isSidebarCollapsed ? 'bg-accent text-accent-foreground' : ''}`}
          title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {isSidebarCollapsed ? (
            <PanelRightIcon className="size-4" />
          ) : (
            <PanelLeftIcon className="size-4" />
          )}
        </Button>
        {/* Breadcrumbs */}
        <nav aria-label="breadcrumb" className="min-w-0 overflow-hidden">
          <ol className="flex min-w-0 items-center gap-1.5">
            {breadcrumbs.map((item, index) => (
              <li key={index} className="inline-flex min-w-0 items-center gap-1.5">
                {index > 0 && (
                  <svg className="size-3.5 shrink-0 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
                {item.href && index < breadcrumbs.length - 1 ? (
                  <a
                    href={item.href}
                    className="max-w-[40vw] cursor-pointer truncate text-sm text-muted-foreground transition-colors hover:text-foreground sm:max-w-none"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span className="max-w-[55vw] truncate text-sm font-medium text-foreground sm:max-w-none">
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {/* Right Section: Fullscreen + Dark Mode + User Menu */}
      <div className="flex items-center gap-2">
        {/* Fullscreen Toggle - Shows current state */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className={`cursor-pointer transition-colors ${isFullscreen ? 'bg-accent text-accent-foreground' : ''}`}
          title={isFullscreen ? 'Exit fullscreen (click to minimize)' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <MaximizeIcon className="size-4" />
          ) : (
            <MinimizeIcon className="size-4" />
          )}
        </Button>

        {/* Dark Mode Toggle - Shows current state */}
        <Button
          variant="ghost"
          size="icon"
          onClick={(e) => toggleDarkMode(e)}
          className={`cursor-pointer transition-colors ${isDarkMode ? 'bg-accent text-accent-foreground' : ''}`}
          title={isDarkMode ? 'Dark mode (click for light)' : 'Light mode (click for dark)'}
        >
          {isDarkMode ? (
            <MoonIcon className="size-4" />
          ) : (
            <SunIcon className="size-4" />
          )}
        </Button>

        {/* User Menu */}
        <ProfileDropdown>
          <Button variant="ghost" size="icon" className="cursor-pointer">
            <ProfileIcon className="size-4" />
          </Button>
        </ProfileDropdown>
      </div>
    </header>
  )
}
