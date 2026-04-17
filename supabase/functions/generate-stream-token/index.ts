import { createClient } from 'jsr:@supabase/supabase-js@2'
import { StreamChat } from 'npm:stream-chat@^8.40.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  console.log('Function invoked:', req.method, req.url)

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    console.log('Processing request...')

    // Get the JWT token from Authorization header
    const authHeader = req.headers.get('Authorization')
    console.log('Auth header present:', !!authHeader)

    if (!authHeader) {
      throw new Error('Missing authorization header')
    }

    const token = authHeader.replace('Bearer ', '')
    console.log('Token extracted, length:', token.length)

    // Create Supabase client for database operations
    // Try both SUPABASE_ANON_KEY (legacy) and SUPABASE_PUBLISHABLE_KEY (new)
    const supabaseKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')

    if (!supabaseKey) {
      throw new Error('Missing Supabase key in environment')
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      supabaseKey
    )

    // Verify JWT and get user by passing the token directly
    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser(token)

    if (userError || !user) {
      console.error('User verification failed:', userError)
      throw new Error(`Invalid user token: ${userError?.message || 'No user'}`)
    }

    // Get Stream.io API credentials from environment
    const streamApiKey = Deno.env.get('STREAM_API_KEY')
    const streamApiSecret = Deno.env.get('STREAM_API_SECRET')

    if (!streamApiKey || !streamApiSecret) {
      throw new Error('Stream.io credentials not configured')
    }

    // Create Stream server client
    const serverClient = StreamChat.getInstance(streamApiKey, streamApiSecret)

    // Generate Stream token for the user
    const streamToken = serverClient.createToken(user.id)

    // Get user profile for additional info
    const { data: profile } = await supabaseClient
      .from('profiles')
      .select('full_name, avatar_url')
      .eq('id', user.id)
      .single()

    return new Response(
      JSON.stringify({
        token: streamToken,
        userId: user.id,
        userName: profile?.full_name || user.email?.split('@')[0] || 'User',
        avatarUrl: profile?.avatar_url,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})
