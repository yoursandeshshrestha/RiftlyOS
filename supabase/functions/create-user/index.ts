import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Get request body
    const { email, password, full_name, role, workspace_id } = await req.json()

    // Validate inputs
    if (!email || !password || !full_name || !role || !workspace_id) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'Password must be at least 6 characters' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create admin client
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    )

    // Verify the requesting user is authenticated and is an owner
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token)

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if user is owner of the workspace
    const { data: memberData, error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspace_id)
      .eq('user_id', user.id)
      .single()

    if (memberError || memberData?.role !== 'owner') {
      return new Response(
        JSON.stringify({ error: 'Only workspace owners can create users' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Create user with admin API (no email confirmation)
    const { data: newUser, error: createUserError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm email
      user_metadata: {
        full_name,
      },
    })

    if (createUserError) {
      console.error('Error creating user:', createUserError)

      // Return user-friendly error messages
      let errorMessage = createUserError.message
      if (errorMessage.includes('already been registered')) {
        errorMessage = 'A user with this email already exists'
      }

      return new Response(
        JSON.stringify({ error: errorMessage }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!newUser.user) {
      return new Response(
        JSON.stringify({ error: 'Failed to create user' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Wait a moment for any triggers to complete
    await new Promise(resolve => setTimeout(resolve, 1000))

    // Check if profile already exists (might be created by trigger)
    const { data: existingProfile } = await supabaseAdmin
      .from('profiles')
      .select('id')
      .eq('id', newUser.user.id)
      .single()

    if (!existingProfile) {
      // Create profile if it doesn't exist
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .insert({
          id: newUser.user.id,
          email: email,
          full_name: full_name,
          onboarding_completed: true,
        })

      if (profileError) {
        console.error('Error creating profile:', JSON.stringify(profileError, null, 2))
        // Try to delete the auth user if profile creation fails
        await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
        return new Response(
          JSON.stringify({
            error: `Failed to create profile: ${profileError.message || profileError.code || 'Unknown error'}`,
            code: profileError.code,
            hint: profileError.hint,
            details: profileError.details
          }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    } else {
      // Profile exists, update it with the full name and mark onboarding as complete
      const { error: updateError } = await supabaseAdmin
        .from('profiles')
        .update({
          full_name: full_name,
          onboarding_completed: true,
        })
        .eq('id', newUser.user.id)

      if (updateError) {
        console.error('Error updating profile:', JSON.stringify(updateError, null, 2))
      }
    }

    // Add to workspace
    const { error: workspaceError } = await supabaseAdmin
      .from('workspace_members')
      .insert({
        workspace_id: workspace_id,
        user_id: newUser.user.id,
        role: role,
      })

    if (workspaceError) {
      console.error('Error adding to workspace:', workspaceError)
      // Try to clean up
      await supabaseAdmin.from('profiles').delete().eq('id', newUser.user.id)
      await supabaseAdmin.auth.admin.deleteUser(newUser.user.id)
      return new Response(
        JSON.stringify({ error: 'Failed to add user to workspace' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({
        success: true,
        user: {
          id: newUser.user.id,
          email: newUser.user.email,
          full_name: full_name,
          role: role,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Unexpected error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
