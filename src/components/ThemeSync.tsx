import { useEffect, useRef } from 'react'
import { useTheme } from 'next-themes'
import { useAuth } from '@/contexts/AuthContext'

/** Applies the user's saved profile theme once per login session. */
export function ThemeSync() {
  const { user } = useAuth()
  const { setTheme } = useTheme()
  const syncedUserId = useRef<string | null>(null)

  useEffect(() => {
    if (!user?.id) {
      syncedUserId.current = null
      return
    }

    if (!user.theme || syncedUserId.current === user.id) {
      return
    }

    syncedUserId.current = user.id
    setTheme(user.theme)
  }, [user?.id, user?.theme, setTheme])

  return null
}
