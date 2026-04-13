import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Maximize2, Minimize2, Moon, Sun } from 'lucide-react'
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
}

export function Header({ breadcrumbs = [{ label: 'Dashboard' }], onMenuClick }: HeaderProps) {
  const { user } = useAuth()
  const [notificationsOpen, setNotificationsOpen] = useState(false)
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

  const toggleDarkMode = async () => {
    const newTheme = isDarkMode ? 'light' : 'dark'

    // Update UI immediately
    if (isDarkMode) {
      document.documentElement.classList.remove('dark')
      setIsDarkMode(false)
    } else {
      document.documentElement.classList.add('dark')
      setIsDarkMode(true)
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
      <div className="flex items-center gap-3">
        {/* Sidebar Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={onMenuClick}
          className="shrink-0 cursor-pointer"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-4"
          >
            <path d="M3 11C3 7.22876 3 5.34315 4.17157 4.17157C5.34315 3 7.22876 3 11 3H13C16.7712 3 18.6569 3 19.8284 4.17157C21 5.34315 21 7.22876 21 11V13C21 16.7712 21 18.6569 19.8284 19.8284C18.6569 21 16.7712 21 13 21H11C7.22876 21 5.34315 21 4.17157 19.8284C3 18.6569 3 16.7712 3 13V11Z" />
            <path d="M15 3V21" />
            <path d="M10 9L8.89181 9.87868C7.6306 10.8787 7 11.3787 7 12C7 12.6213 7.6306 13.1213 8.89181 14.1213L10 15" />
          </svg>
        </Button>
        {/* Breadcrumbs */}
        <nav aria-label="breadcrumb">
          <ol className="flex items-center gap-1.5">
            {breadcrumbs.map((item, index) => (
              <li key={index} className="inline-flex items-center gap-1.5">
                {index > 0 && (
                  <svg className="size-3.5 text-muted-foreground/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                )}
                {item.href && index < breadcrumbs.length - 1 ? (
                  <a
                    href={item.href}
                    className="cursor-pointer text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {item.label}
                  </a>
                ) : (
                  <span className="text-sm font-medium text-foreground">
                    {item.label}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </nav>
      </div>

      {/* Right Section: Fullscreen + Dark Mode + Notifications + User Menu */}
      <div className="flex items-center gap-2">
        {/* Fullscreen Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleFullscreen}
          className="cursor-pointer"
        >
          {isFullscreen ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </Button>

        {/* Dark Mode Toggle */}
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleDarkMode}
          className="cursor-pointer"
        >
          {isDarkMode ? (
            <Sun className="size-4" />
          ) : (
            <Moon className="size-4" />
          )}
        </Button>

        {/* Notifications */}
        <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="relative cursor-pointer">
              <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
              </svg>
              <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-semibold text-white">
                3
              </span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Notifications</span>
              <Badge variant="secondary" className="ml-auto">3 new</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer flex-col items-start gap-1 p-3">
              <div className="flex w-full items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-100">
                  <svg className="size-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">New order received</p>
                  <p className="text-xs text-muted-foreground">Order #3210 from John Doe</p>
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer flex-col items-start gap-1 p-3">
              <div className="flex w-full items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-orange-200 bg-orange-100">
                  <svg className="size-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Payment pending</p>
                  <p className="text-xs text-muted-foreground">Invoice #1234 awaiting payment</p>
                </div>
              </div>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer flex-col items-start gap-1 p-3">
              <div className="flex w-full items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-green-200 bg-green-100">
                  <svg className="size-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">New customer registered</p>
                  <p className="text-xs text-muted-foreground">Jane Smith joined 2 hours ago</p>
                </div>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* User Menu */}
        <ProfileDropdown>
          <Button variant="ghost" size="icon" className="cursor-pointer">
            <svg className="size-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
          </Button>
        </ProfileDropdown>
      </div>
    </header>
  )
}
