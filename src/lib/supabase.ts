import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!supabaseUrl || !supabasePublishableKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.')
}

// Create singleton instance
let supabaseInstance: SupabaseClient<Database> | null = null

function getSupabaseClient() {
  if (!supabaseInstance) {
    supabaseInstance = createClient<Database>(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce',
      },
    })
  }
  return supabaseInstance
}

export const supabase = getSupabaseClient()

// Type helpers
export type Profile = Database['public']['Tables']['profiles']['Row']
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert']
export type ProfileUpdate = Database['public']['Tables']['profiles']['Update']

// Auth error checker
export function isAuthError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false

  const authErrorCodes = ['PGRST301', '401', '403']
  const authErrorMessages = ['JWT', 'session', 'expired', 'invalid', 'unauthorized']

  return (
    authErrorCodes.some(code => error.code?.includes(code)) ||
    authErrorMessages.some(msg => error.message?.toLowerCase().includes(msg.toLowerCase()))
  )
}

// Handle auth errors globally
export async function handleAuthError(error: { code?: string; message?: string } | null) {
  if (isAuthError(error)) {
    console.error('Authentication error detected, signing out:', error)
    await supabase.auth.signOut()
    return true
  }
  return false
}
