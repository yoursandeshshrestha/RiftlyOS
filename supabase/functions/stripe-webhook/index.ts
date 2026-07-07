/**
 * Stripe webhook handler
 * Verifies signature, dedupes on event.id, and reconciles to our database.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from '../_shared/env.ts'
import { StripeConnector } from '../_shared/stripe-connector.ts'
import {
  recordAndCheckEvent,
  markEventProcessed,
  reconcileInvoiceEvent,
  reconcileSubscriptionEvent,
} from '../_shared/webhook-reconcile.ts'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const signature = req.headers.get('stripe-signature')
  if (!signature) {
    return new Response(
      JSON.stringify({ error: 'Missing stripe-signature header' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Read raw body for signature verification
  const rawBody = await req.text()

  // Verify webhook signature
  let event
  try {
    event = StripeConnector.verifyWebhook(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET(),
    )
  } catch (err) {
    console.error('Webhook signature verification failed:', err)
    return new Response(
      JSON.stringify({
        error: `Signature verification failed: ${err.message}`,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Create service_role client (bypasses RLS for webhook processing)
  const supabase = createClient<Database>(
    env.SUPABASE_URL(),
    env.SUPABASE_SERVICE_ROLE_KEY(),
  )

  // Dedupe on event.id
  const { isDuplicate } = await recordAndCheckEvent(supabase, event)
  if (isDuplicate) {
    console.log(`Event ${event.id} already processed (duplicate)`)
    return new Response(
      JSON.stringify({ received: true, duplicate: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  // Reconcile based on event type
  try {
    if (event.type.startsWith('invoice.')) {
      await reconcileInvoiceEvent(supabase, event)
    } else if (event.type.startsWith('customer.subscription.')) {
      await reconcileSubscriptionEvent(supabase, event)
    }
    // Other event types are recorded but not reconciled (no-op)

    await markEventProcessed(supabase, event.id)

    console.log(`Event ${event.id} (${event.type}) processed successfully`)
    return new Response(
      JSON.stringify({ received: true, eventId: event.id, type: event.type }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err) {
    console.error(`Failed to reconcile event ${event.id}:`, err)
    return new Response(
      JSON.stringify({ error: `Reconciliation failed: ${err.message}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
