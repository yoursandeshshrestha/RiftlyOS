/**
 * Create invoice Edge Function
 * Handles both one-off invoices and subscription (retainer) creation
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from '../_shared/env.ts'
import { StripeConnector } from '../_shared/stripe-connector.ts'

interface CreateInvoiceRequest {
  workspaceId: string
  type: 'one_off' | 'retainer'
  currency: string
  amount: number // minor units
  description?: string
  daysUntilDue?: number
  dayOfMonth?: number // for retainers
  lines?: Array<{
    description: string
    quantity: number
    unitAmount: number
  }>
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing authorization' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient<Database>(
    env.SUPABASE_URL(),
    env.SUPABASE_SERVICE_ROLE_KEY(),
    { global: { headers: { Authorization: authHeader } } },
  )

  // Verify user is authenticated
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  // Parse request
  const body: CreateInvoiceRequest = await req.json()

  try {
    // Get or create customer
    let { data: customer } = await supabase
      .from('customers')
      .select('*')
      .eq('workspace_id', body.workspaceId)
      .single()

    // Get workspace name for customer creation
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('name')
      .eq('id', body.workspaceId)
      .single()

    if (!customer) {
      // Create Stripe customer
      const stripeCustomer = await StripeConnector.createCustomer({
        workspaceId: body.workspaceId,
        name: workspace?.name ?? body.workspaceId,
        currency: body.currency,
      })

      // Mirror locally
      const { data: newCustomer } = await supabase
        .from('customers')
        .insert({
          workspace_id: body.workspaceId,
          stripe_customer_id: stripeCustomer.id,
          default_currency: body.currency,
        })
        .select()
        .single()

      customer = newCustomer
    }

    if (!customer?.stripe_customer_id) {
      throw new Error('Customer missing Stripe ID')
    }

    if (body.type === 'retainer') {
      // Create subscription
      const subscription = await StripeConnector.createRetainer({
        stripeCustomerId: customer.stripe_customer_id,
        workspaceId: body.workspaceId,
        currency: body.currency,
        amount: body.amount,
        productName: body.description ?? 'Monthly Retainer',
        dayOfMonth: body.dayOfMonth,
      })

      // Mirror locally
      const { data: sub } = await supabase
        .from('subscriptions')
        .insert({
          workspace_id: body.workspaceId,
          provider: 'stripe',
          provider_subscription_id: subscription.id,
          amount: body.amount,
          currency: body.currency,
          interval: 'month',
          day_of_month: body.dayOfMonth ?? null,
          status: 'active',
          current_period_start: subscription.current_period_start
            ? new Date(subscription.current_period_start * 1000).toISOString()
            : null,
          current_period_end: subscription.current_period_end
            ? new Date(subscription.current_period_end * 1000).toISOString()
            : null,
        })
        .select()
        .single()

      return new Response(JSON.stringify({ subscription: sub }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    } else {
      // Create one-off invoice
      const lines = body.lines ?? [
        {
          description: body.description ?? 'Service',
          quantity: 1,
          unitAmount: body.amount,
        },
      ]

      const stripeInvoice = await StripeConnector.createOneOffInvoice({
        stripeCustomerId: customer.stripe_customer_id,
        workspaceId: body.workspaceId,
        currency: body.currency,
        lines,
        daysUntilDue: body.daysUntilDue ?? 14,
      })

      // Mirror locally
      const { data: invoice } = await supabase
        .from('invoices')
        .insert({
          workspace_id: body.workspaceId,
          type: 'one_off',
          status: 'open',
          provider: 'stripe',
          provider_invoice_id: stripeInvoice.id,
          currency: body.currency,
          subtotal: stripeInvoice.subtotal ?? 0,
          tax_total: stripeInvoice.tax ?? 0,
          total: stripeInvoice.total ?? 0,
          issued_at: new Date().toISOString(),
          hosted_url: stripeInvoice.hosted_invoice_url ?? undefined,
          pdf_url: stripeInvoice.invoice_pdf ?? undefined,
        })
        .select()
        .single()

      // Insert line items
      if (invoice) {
        await supabase.from('line_items').insert(
          lines.map((line) => ({
            workspace_id: body.workspaceId,
            invoice_id: invoice.id,
            description: line.description,
            quantity: line.quantity,
            unit_amount: line.unitAmount,
          })),
        )
      }

      return new Response(JSON.stringify({ invoice }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  } catch (err) {
    console.error('Create invoice/subscription error:', err)
    return new Response(
      JSON.stringify({ error: err.message ?? 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
