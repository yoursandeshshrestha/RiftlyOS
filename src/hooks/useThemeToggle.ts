import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import type { ThemePreference } from '@/lib/theme'

export function useThemeToggle() {
  const { user, updateTheme } = useAuth()
  const { setTheme, resolvedTheme } = useTheme()
  const isDarkMode = resolvedTheme === 'dark'

  async function persistTheme(theme: ThemePreference) {
    if (!user?.id) return

    try {
      const { error } = await supabase
        .from('profiles')
        .update({ theme } as never)
        .eq('id', user.id)

      if (error) {
        console.error('Error saving theme preference:', error)
      }
    } catch (error) {
      console.error('Error saving theme preference:', error)
    }
  }

  function applyTheme(theme: ThemePreference) {
    setTheme(theme)
    updateTheme(theme)
  }

  async function toggleTheme(e?: React.MouseEvent) {
    const newTheme: ThemePreference = isDarkMode ? 'light' : 'dark'
    const root = document.documentElement

    if (e && document.startViewTransition) {
      root.style.setProperty('--x', `${e.clientX}px`)
      root.style.setProperty('--y', `${e.clientY}px`)
      document.startViewTransition(() => applyTheme(newTheme))
    } else {
      applyTheme(newTheme)
    }

    await persistTheme(newTheme)
  }

  return { isDarkMode, toggleTheme, applyTheme, resolvedTheme }
}
