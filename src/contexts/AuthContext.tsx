import { createContext, useContext, useState, useEffect } from 'react'
import type { ReactNode } from 'react'
import { supabase, handleAuthError } from '@/lib/supabase'
import type { Session } from '@supabase/supabase-js'

interface ProfileData {
  id: string
  email: string
  full_name: string
  theme: string | null
  onboarding_completed: boolean
  last_accessed_workspace_id: string | null
  avatar_url: string | null
}

interface User {
  id: string
  email: string
  name: string
  theme: 'light' | 'dark' | 'system'
  onboarding_completed: boolean
  last_accessed_workspace_id: string | null
  avatarUrl: string | null
}

interface AuthContextType {
  user: User | null
  session: Session | null
  isLoading: boolean
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      if (session?.user) {
        loadUserProfile(session.user.id)
      } else {
        setIsLoading(false)
      }
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('Auth state changed:', event)

      setSession(session)

      if (event === 'SIGNED_OUT') {
        setUser(null)
        setSession(null)
        setIsLoading(false)
      } else if (event === 'TOKEN_REFRESHED') {
        console.log('Token refreshed successfully')
      } else if (session?.user) {
        loadUserProfile(session.user.id)
      } else {
        setUser(null)
        setIsLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadUserProfile(userId: string) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error) {
        // Check if it's an auth error and handle it
        const wasAuthError = await handleAuthError(error)
        if (wasAuthError) return

        // Check if profile doesn't exist (PGRST116 - no rows found)
        if (error.code === 'PGRST116') {
          console.error('Profile not found for authenticated user. Logging out.')
          // Profile doesn't exist but auth session does - this is a data inconsistency
          // Log the user out completely
          await supabase.auth.signOut()
          setUser(null)
          setSession(null)
          setIsLoading(false)
          return
        }

        throw error
      }

      const profileData = data as ProfileData

      setUser({
        id: profileData.id,
        email: profileData.email,
        name: profileData.full_name,
        theme: (profileData.theme as 'light' | 'dark' | 'system') || 'system',
        onboarding_completed: profileData.onboarding_completed,
        last_accessed_workspace_id: profileData.last_accessed_workspace_id,
        avatarUrl: profileData.avatar_url,
      })
    } catch (error) {
      console.error('Error loading profile:', error)
      // For other errors, log out the user to be safe
      await supabase.auth.signOut()
      setUser(null)
      setSession(null)
    } finally {
      setIsLoading(false)
    }
  }

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
  }

  async function logout() {
    const { error } = await supabase.auth.signOut()
    if (error) throw error
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        isLoading,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
