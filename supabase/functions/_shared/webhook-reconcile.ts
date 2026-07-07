/**
 * Webhook reconciliation - sync Stripe events to our database.
 * Maps provider object IDs to workspace_id and updates invoice/subscription status.
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from './env.ts'

type SupabaseClient = ReturnType<typeof createClient<Database>>
type InvoiceStatus = Database['public']['Enums']['invoice_status']

type StripeInvoiceLine = {
  description?: string | null
  quantity?: number | null
  amount?: number | null
  unit_amount?: number | null
}

type StripeInvoiceObject = {
  id: string
  object: string
  amount_paid?: number | null
  currency?: string | null
  status?: string | null
  due_date?: number | null
  hosted_invoice_url?: string | null
  invoice_pdf?: string | null
  payment_intent?: string | { id: string } | null
  subtotal?: number | null
  tax?: number | null
  total?: number | null
  metadata?: Record<string, string> | null
  customer?: string | null
  subscription?: string | { id: string } | null
  lines?: { data?: StripeInvoiceLine[] | null } | null
}

function stripeDueDateToIso(dueDate: number | null | undefined): string | null {
  if (!dueDate) return null
  return new Date(dueDate * 1000).toISOString().slice(0, 10)
}

function mapStripeInvoiceStatus(status: string | null | undefined): InvoiceStatus {
  const map: Record<string, InvoiceStatus> = {
    draft: 'draft',
    open: 'open',
    paid: 'paid',
    uncollectible: 'uncollectible',
    void: 'void',
  }
  return map[status ?? ''] ?? 'open'
}

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
  const fromMeta = obj.metadata?.workspace_id
  if (fromMeta) return fromMeta

  if (obj.customer) {
    const { data, error } = await supabase
      .from('customers')
      .select('workspace_id')
      .eq('stripe_customer_id', obj.customer)
      .maybeSingle()

    if (error) {
      console.error('Customer lookup failed:', error.message)
      return null
    }

    return data?.workspace_id ?? null
  }

  return null
}

async function resolveInvoiceContext(
  supabase: SupabaseClient,
  workspaceId: string,
  obj: StripeInvoiceObject,
): Promise<{
  subscriptionId: string | null
  clientUserId: string | null
  invoiceType: Database['public']['Enums']['invoice_type']
}> {
  const stripeSubscriptionId =
    typeof obj.subscription === 'string' ? obj.subscription : obj.subscription?.id ?? null

  let subscriptionId: string | null = null
  let clientUserId: string | null = null

  if (stripeSubscriptionId) {
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('id, client_user_id')
      .eq('provider_subscription_id', stripeSubscriptionId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    subscriptionId = sub?.id ?? null
    clientUserId = sub?.client_user_id ?? null
  }

  if (!clientUserId && obj.customer) {
    const { data: customer } = await supabase
      .from('customers')
      .select('client_user_id')
      .eq('stripe_customer_id', obj.customer)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    clientUserId = customer?.client_user_id ?? null
  }

  return {
    subscriptionId,
    clientUserId,
    invoiceType: stripeSubscriptionId ? 'retainer' : 'one_off',
  }
}

async function insertInvoiceLineItems(
  supabase: SupabaseClient,
  workspaceId: string,
  invoiceId: string,
  lines: StripeInvoiceLine[],
): Promise<void> {
  if (lines.length === 0) return

  const { error } = await supabase.from('line_items').insert(
    lines.map((line) => ({
      workspace_id: workspaceId,
      invoice_id: invoiceId,
      description: line.description ?? 'Service',
      quantity: line.quantity ?? 1,
      unit_amount: line.unit_amount ?? line.amount ?? 0,
    })),
  )

  if (error) {
    console.error('Failed to insert invoice line items:', error.message)
  }
}

async function syncStripeInvoice(
  supabase: SupabaseClient,
  workspaceId: string,
  obj: StripeInvoiceObject,
  eventType: string,
): Promise<string | null> {
  const dueDate = stripeDueDateToIso(obj.due_date)
  let status = mapStripeInvoiceStatus(obj.status)
  if (eventType === 'invoice.payment_failed') {
    status = 'past_due'
  }

  const fields = {
    status,
    subtotal: obj.subtotal ?? 0,
    tax_total: obj.tax ?? 0,
    total: obj.total ?? 0,
    amount_paid: obj.amount_paid ?? 0,
    ...(dueDate ? { due_date: dueDate } : {}),
    hosted_url: obj.hosted_invoice_url ?? undefined,
    pdf_url: obj.invoice_pdf ?? undefined,
    ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}),
    ...(['invoice.finalized', 'invoice.paid', 'invoice.sent'].includes(eventType)
      ? { issued_at: new Date().toISOString() }
      : {}),
  }

  const { data: existing } = await supabase
    .from('invoices')
    .select('id')
    .eq('provider_invoice_id', obj.id)
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('invoices')
      .update(fields)
      .eq('id', existing.id)

    if (error) {
      throw new Error(`Failed to update invoice: ${error.message}`)
    }

    return existing.id
  }

  const { subscriptionId, clientUserId, invoiceType } = await resolveInvoiceContext(
    supabase,
    workspaceId,
    obj,
  )

  const { data: inserted, error: insertError } = await supabase
    .from('invoices')
    .insert({
      workspace_id: workspaceId,
      client_user_id: clientUserId,
      type: invoiceType,
      provider: 'stripe',
      provider_invoice_id: obj.id,
      subscription_id: subscriptionId,
      currency: obj.currency ?? 'gbp',
      ...fields,
    })
    .select('id')
    .single()

  if (insertError || !inserted) {
    throw new Error(insertError?.message ?? 'Failed to insert invoice from webhook')
  }

  await insertInvoiceLineItems(
    supabase,
    workspaceId,
    inserted.id,
    obj.lines?.data ?? [],
  )

  return inserted.id
}

/**
 * Reconcile invoice.* events into our invoices/payments tables
 */
export async function reconcileInvoiceEvent(
  supabase: SupabaseClient,
  event: {
    id: string
    type: string
    data: { object: StripeInvoiceObject }
  },
): Promise<void> {
  const obj = event.data.object
  const workspaceId = await resolveWorkspaceId(supabase, obj)

  if (!workspaceId) {
    console.warn(`Skipping ${event.type}: cannot map Stripe object ${obj.id} to a workspace`)
    return
  }

  if (
    event.type === 'invoice.finalized' ||
    event.type === 'invoice.paid' ||
    event.type === 'invoice.payment_failed' ||
    event.type === 'invoice.sent'
  ) {
    await syncStripeInvoice(supabase, workspaceId, obj, event.type)
  }

  if (event.type === 'invoice.paid') {
    const paymentIntent =
      typeof obj.payment_intent === 'string'
        ? obj.payment_intent
        : obj.payment_intent?.id

    if (paymentIntent) {
      const { data: invoice } = await supabase
        .from('invoices')
        .select('id')
        .eq('provider_invoice_id', obj.id)
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      await supabase.from('payments').upsert(
        {
          workspace_id: workspaceId,
          invoice_id: invoice?.id ?? null,
          provider: 'stripe',
          provider_payment_id: paymentIntent,
          amount: obj.amount_paid ?? 0,
          currency: obj.currency ?? 'gbp',
          status: 'succeeded',
          paid_at: new Date().toISOString(),
        },
        { onConflict: 'provider_payment_id', ignoreDuplicates: true },
      )
    }
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
    console.warn(`Skipping ${event.type}: cannot map Stripe object ${obj.id} to a workspace`)
    return
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
  const pauseCollection = (obj as { pause_collection?: { behavior?: string } | null })
    .pause_collection
  const billingPaused = Boolean(pauseCollection)

  let periodStart: string | null = obj.current_period_start
    ? new Date(obj.current_period_start * 1000).toISOString()
    : null
  let periodEnd: string | null = obj.current_period_end
    ? new Date(obj.current_period_end * 1000).toISOString()
    : null

  if (!periodStart || !periodEnd) {
    const items = (obj as { items?: { data?: Array<{ current_period_start?: number; current_period_end?: number }> } }).items?.data
    const item = items?.[0]
    if (item?.current_period_start && item?.current_period_end) {
      periodStart = new Date(item.current_period_start * 1000).toISOString()
      periodEnd = new Date(item.current_period_end * 1000).toISOString()
    }
  }

  await supabase
    .from('subscriptions')
    .update({
      status: mappedStatus,
      billing_paused: billingPaused,
      current_period_start: periodStart,
      current_period_end: periodEnd,
    })
    .eq('provider_subscription_id', obj.id)
    .eq('workspace_id', workspaceId)
}
