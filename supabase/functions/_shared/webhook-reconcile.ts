/**
 * Webhook reconciliation - sync Stripe events to our database.
 * Maps provider object IDs to workspace_id and updates invoice/subscription status.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from './env.ts'

type SupabaseClient = ReturnType<typeof createClient<Database>>

/**
 * Record a Stripe event for idempotency checking.
 * Returns isDuplicate=true if event.id was already seen.
 */
export async function recordAndCheckEvent(
  supabase: SupabaseClient,
  event: { id: string; type: string; data: unknown },
): Promise<{ isDuplicate: boolean }> {
  const { data, error } = await supabase
    .from('stripe_events')
    .insert({
      id: event.id,
      type: event.type,
      payload: event as unknown as Record<string, unknown>,
    })
    .select()

  // If insert failed due to unique constraint, it's a duplicate
  if (error && error.code === '23505') {
    return { isDuplicate: true }
  }

  if (error) {
    throw new Error(`Failed to record event: ${error.message}`)
  }

  return { isDuplicate: false }
}

/**
 * Mark event as processed
 */
export async function markEventProcessed(
  supabase: SupabaseClient,
  eventId: string,
): Promise<void> {
  await supabase
    .from('stripe_events')
    .update({ processed_at: new Date().toISOString() })
    .eq('id', eventId)
}

/**
 * Resolve workspace_id from Stripe object metadata or customer lookup
 */
async function resolveWorkspaceId(
  supabase: SupabaseClient,
  obj: {
    metadata?: Record<string, string> | null
    customer?: string | null
  },
): Promise<string | null> {
  // Try metadata first (defense in depth)
  const fromMeta = obj.metadata?.workspace_id
  if (fromMeta) return fromMeta

  // Fallback: lookup by stripe_customer_id
  if (obj.customer) {
    const { data } = await supabase
      .from('customers')
      .select('workspace_id')
      .eq('stripe_customer_id', obj.customer)
      .single()

    return data?.workspace_id ?? null
  }

  return null
}

/**
 * Reconcile invoice.* events into our invoices/payments tables
 */
export async function reconcileInvoiceEvent(
  supabase: SupabaseClient,
  event: {
    id: string
    type: string
    data: {
      object: {
        id: string
        object: string
        amount_paid?: number | null
        currency?: string | null
        status?: string | null
        hosted_invoice_url?: string | null
        invoice_pdf?: string | null
        payment_intent?: string | { id: string } | null
        subtotal?: number | null
        tax?: number | null
        total?: number | null
        metadata?: Record<string, string> | null
        customer?: string | null
      }
    }
  },
): Promise<void> {
  const obj = event.data.object
  const workspaceId = await resolveWorkspaceId(supabase, obj)

  if (!workspaceId) {
    throw new Error(`Cannot map Stripe invoice ${obj.id} to a workspace`)
  }

  if (event.type === 'invoice.paid') {
    // Update invoice status to paid
    await supabase
      .from('invoices')
      .update({
        status: 'paid',
        amount_paid: obj.amount_paid ?? 0,
        paid_at: new Date().toISOString(),
        hosted_url: obj.hosted_invoice_url ?? undefined,
        pdf_url: obj.invoice_pdf ?? undefined,
      })
      .eq('provider_invoice_id', obj.id)
      .eq('workspace_id', workspaceId)

    // Record the payment
    const paymentIntent =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : obj.payment_intent?.id

    if (paymentIntent) {
      await supabase
        .from('payments')
        .insert({
          workspace_id: workspaceId,
          provider: 'stripe',
          provider_payment_id: paymentIntent,
          amount: obj.amount_paid ?? 0,
          currency: obj.currency ?? 'gbp',
          status: 'succeeded',
          paid_at: new Date().toISOString(),
        })
        .onConflict('provider_payment_id')
        .ignoreDuplicates()
    }
    return
  }

  if (event.type === 'invoice.payment_failed') {
    await supabase
      .from('invoices')
      .update({ status: 'past_due' })
      .eq('provider_invoice_id', obj.id)
      .eq('workspace_id', workspaceId)
    return
  }

  if (event.type === 'invoice.finalized') {
    await supabase
      .from('invoices')
      .update({
        status: 'open',
        issued_at: new Date().toISOString(),
        subtotal: obj.subtotal ?? 0,
        tax_total: obj.tax ?? 0,
        total: obj.total ?? 0,
        hosted_url: obj.hosted_invoice_url ?? undefined,
        pdf_url: obj.invoice_pdf ?? undefined,
      })
      .eq('provider_invoice_id', obj.id)
      .eq('workspace_id', workspaceId)
    return
  }
}

/**
 * Reconcile customer.subscription.* events into our subscriptions table
 */
export async function reconcileSubscriptionEvent(
  supabase: SupabaseClient,
  event: {
    id: string
    type: string
    data: {
      object: {
        id: string
        status: string
        current_period_start?: number | null
        current_period_end?: number | null
        metadata?: Record<string, string> | null
        customer?: string | null
      }
    }
  },
): Promise<void> {
  const obj = event.data.object
  const workspaceId = await resolveWorkspaceId(supabase, obj)

  if (!workspaceId) {
    throw new Error(`Cannot map Stripe subscription ${obj.id} to a workspace`)
  }

  const STATUS_MAP: Record<string, Database['public']['Enums']['subscription_status']> = {
    active: 'active',
    past_due: 'past_due',
    canceled: 'canceled',
    incomplete: 'incomplete',
    incomplete_expired: 'canceled',
    trialing: 'trialing',
    unpaid: 'unpaid',
  }

  const mappedStatus = STATUS_MAP[obj.status] ?? 'incomplete'
  const periodStart = obj.current_period_start
    ? new Date(obj.current_period_start * 1000).toISOString()
    : null
  const periodEnd = obj.current_period_end
    ? new Date(obj.current_period_end * 1000).toISOString()
    : null

  await supabase
    .from('subscriptions')
    .update({
      status: mappedStatus,
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .eq('provider_subscription_id', obj.id)
    .eq('workspace_id', workspaceId)
}
