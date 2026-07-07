/**
 * Pause or resume a Stripe retainer subscription
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from '../_shared/env.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { StripeConnector } from '../_shared/stripe-connector.ts'

interface ManageSubscriptionRequest {
  workspaceId: string
  subscriptionId: string
  action: 'pause' | 'resume'
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers: corsHeaders,
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return jsonResponse({ error: 'Missing authorization' }, 401)
  }

  let body: ManageSubscriptionRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  if (!body.workspaceId?.trim() || !body.subscriptionId?.trim()) {
    return jsonResponse({ error: 'Workspace and subscription are required' }, 400)
  }

  if (body.action !== 'pause' && body.action !== 'resume') {
    return jsonResponse({ error: 'Action must be pause or resume' }, 400)
  }

  const supabaseAdmin = createClient<Database>(
    env.SUPABASE_URL(),
    env.SUPABASE_SERVICE_ROLE_KEY(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )

  const token = authHeader.replace('Bearer ', '')
  const {
    data: { user },
    error: authError,
  } = await supabaseAdmin.auth.getUser(token)

  if (authError || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const { data: member, error: memberError } = await supabaseAdmin
    .from('workspace_members')
    .select('role')
    .eq('workspace_id', body.workspaceId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (memberError) {
    return jsonResponse({ error: 'Failed to verify workspace access' }, 403)
  }

  if (!member || !['owner', 'employee'].includes(member.role)) {
    return jsonResponse({ error: 'Only workspace staff can manage retainers' }, 403)
  }

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from('subscriptions')
    .select('id, provider_subscription_id, status, billing_paused')
    .eq('id', body.subscriptionId)
    .eq('workspace_id', body.workspaceId)
    .maybeSingle()

  if (subscriptionError) {
    return jsonResponse({ error: subscriptionError.message }, 500)
  }

  if (!subscription) {
    return jsonResponse({ error: 'Retainer not found' }, 404)
  }

  if (!subscription.provider_subscription_id) {
    return jsonResponse({ error: 'Retainer is not linked to Stripe yet' }, 400)
  }

  if (subscription.status === 'canceled') {
    return jsonResponse({ error: 'Canceled retainers cannot be paused or resumed' }, 400)
  }

  if (body.action === 'pause' && subscription.billing_paused) {
    return jsonResponse({ billing_paused: true })
  }

  if (body.action === 'resume' && !subscription.billing_paused) {
    return jsonResponse({ billing_paused: false })
  }

  try {
    if (body.action === 'pause') {
      await StripeConnector.pauseSubscription(subscription.provider_subscription_id)
    } else {
      await StripeConnector.resumeSubscription(subscription.provider_subscription_id)
    }

    const { error: updateError } = await supabaseAdmin
      .from('subscriptions')
      .update({ billing_paused: body.action === 'pause' })
      .eq('id', subscription.id)

    if (updateError) {
      return jsonResponse({ error: updateError.message }, 500)
    }

    return jsonResponse({ billing_paused: body.action === 'pause' }, 200)
  } catch (error) {
    console.error('manage-subscription error:', error)
    return jsonResponse(
      { error: error instanceof Error ? error.message : 'Failed to update retainer' },
      500,
    )
  }
})
