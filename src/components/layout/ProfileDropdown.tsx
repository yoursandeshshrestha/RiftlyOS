import { useState, useEffect } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProfileIcon, SettingsIcon, LogoutIcon, MoonIcon, SunIcon, MaximizeIcon, MinimizeIcon } from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { useThemeToggle } from '@/hooks/useThemeToggle'

interface ProfileDropdownProps {
  children: React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
}

export function ProfileDropdown({ children, align = 'end', side }: ProfileDropdownProps) {
  const { logout, user } = useAuth()
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} side={side} className="w-56">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium leading-tight">
              {user?.name || 'User'}
            </p>
            <p className="text-xs text-muted-foreground">
              {user?.email || 'user@example.com'}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer" onClick={() => void toggleTheme()}>
          {isDarkMode ? <MoonIcon className="mr-2 size-4" /> : <SunIcon className="mr-2 size-4" />}
          <span>{isDarkMode ? 'Dark mode' : 'Light mode'}</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" onClick={toggleFullscreen}>
          {isFullscreen ? <MaximizeIcon className="mr-2 size-4" /> : <MinimizeIcon className="mr-2 size-4" />}
          <span>{isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer">
          <ProfileIcon className="mr-2 size-4" />
          <span>Profile</span>
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer">
          <SettingsIcon className="mr-2 size-4" />
          <span>Settings</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          className="cursor-pointer"
          onClick={async () => {
            try {
              await logout()
            } catch (error) {
              console.error('Logout error:', error)
            }
          }}
        >
          <LogoutIcon className="mr-2 size-4" />
          <span>Log out</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
