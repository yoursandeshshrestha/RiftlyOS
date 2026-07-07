/**
 * Create invoice Edge Function
 * Handles both one-off invoices and subscription (retainer) creation
 */

import { createClient } from 'jsr:@supabase/supabase-js@2'
import type { Database } from '../../../src/lib/database.types.ts'
import { env } from '../_shared/env.ts'
import { corsHeaders } from '../_shared/cors.ts'
import { StripeConnector, getSubscriptionPeriod } from '../_shared/stripe-connector.ts'

declare const EdgeRuntime: {
  waitUntil: (promise: Promise<unknown>) => void
}

function queueInvoiceEmail(invoiceId: string | null | undefined): void {
  if (!invoiceId) return

  const send = StripeConnector.sendInvoice(invoiceId).catch((error) => {
    console.error(`Failed to send invoice ${invoiceId}:`, error)
  })

  if (typeof EdgeRuntime !== 'undefined') {
    EdgeRuntime.waitUntil(send)
  }
}

interface CreateInvoiceRequest {
  workspaceId: string
  clientUserId: string
  type: 'one_off' | 'retainer'
  currency: string
  amount: number // minor units
  description?: string
  billingEmail?: string
  daysUntilDue?: number
  dayOfMonth?: number // for retainers
  lines?: Array<{
    description: string
    quantity: number
    unitAmount: number
  }>
}

type SupabaseAdmin = ReturnType<typeof createClient<Database>>
type CustomerRow = Database['public']['Tables']['customers']['Row']

interface ClientProfile {
  full_name: string
  email: string
}

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function resolveBillingEmail(
  customer: CustomerRow | null,
  clientProfile: ClientProfile,
  override?: string,
): string {
  const trimmedOverride = override?.trim()
  if (trimmedOverride) return trimmedOverride
  if (customer?.billing_email?.trim()) return customer.billing_email.trim()
  if (clientProfile.email?.trim()) return clientProfile.email.trim()

  throw new Error('Billing email is required for the selected client.')
}

async function getWorkspaceClient(
  supabaseAdmin: SupabaseAdmin,
  workspaceId: string,
  clientUserId: string,
): Promise<ClientProfile> {
  const { data: membership, error: membershipError } = await supabaseAdmin
    .from('workspace_members')
    .select('user_id, role')
    .eq('workspace_id', workspaceId)
    .eq('user_id', clientUserId)
    .maybeSingle()

  if (membershipError) {
    throw new Error(`Failed to verify client membership: ${membershipError.message}`)
  }

  if (!membership) {
    throw new Error('Selected client is not a member of this workspace')
  }

  if (membership.role !== 'client') {
    throw new Error('Invoices can only be sent to workspace clients')
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('profiles')
    .select('full_name, email')
    .eq('id', clientUserId)
    .single()

  if (profileError || !profile) {
    throw new Error('Could not load the selected client profile')
  }

  if (!profile.email?.trim()) {
    throw new Error('The selected client does not have an email address')
  }

  return profile
}

async function findCustomerForClient(
  supabaseAdmin: SupabaseAdmin,
  workspaceId: string,
  clientUserId: string,
): Promise<CustomerRow | null> {
  const { data: customer, error } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('client_user_id', clientUserId)
    .maybeSingle()

  if (error) {
    throw new Error(`Failed to load customer: ${error.message}`)
  }

  if (customer) return customer

  const { data: legacyCustomer, error: legacyError } = await supabaseAdmin
    .from('customers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .is('client_user_id', null)
    .maybeSingle()

  if (legacyError) {
    throw new Error(`Failed to load legacy customer: ${legacyError.message}`)
  }

  return legacyCustomer
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

  let body: CreateInvoiceRequest
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400)
  }

  if (!body.workspaceId?.trim()) {
    return jsonResponse({ error: 'Workspace is required' }, 400)
  }

  if (!body.clientUserId?.trim()) {
    return jsonResponse({ error: 'Client is required' }, 400)
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
    return jsonResponse({ error: 'Only workspace staff can create invoices' }, 403)
  }

  try {
    const [clientProfile, customerLookup, workspaceResult] = await Promise.all([
      getWorkspaceClient(supabaseAdmin, body.workspaceId, body.clientUserId),
      findCustomerForClient(supabaseAdmin, body.workspaceId, body.clientUserId),
      supabaseAdmin
        .from('workspaces')
        .select('name')
        .eq('id', body.workspaceId)
        .single(),
    ])

    let customer = customerLookup
    const workspace = workspaceResult.data

    const billingEmail = resolveBillingEmail(
      customer,
      clientProfile,
      body.billingEmail,
    )

    const customerName = workspace?.name
      ? `${workspace.name} — ${clientProfile.full_name}`
      : clientProfile.full_name

    if (!customer?.stripe_customer_id) {
      const stripeCustomer = await StripeConnector.createCustomer({
        workspaceId: body.workspaceId,
        clientUserId: body.clientUserId,
        name: customerName,
        email: billingEmail,
        currency: body.currency,
      })

      if (customer) {
        const { data: updatedCustomer, error: updateError } = await supabaseAdmin
          .from('customers')
          .update({
            stripe_customer_id: stripeCustomer.id,
            default_currency: body.currency,
            billing_email: billingEmail,
            client_user_id: body.clientUserId,
          })
          .eq('id', customer.id)
          .select()
          .single()

        if (updateError || !updatedCustomer) {
          throw new Error(
            updateError?.message ?? 'Failed to update customer with Stripe ID',
          )
        }

        customer = updatedCustomer
      } else {
        const { data: newCustomer, error: insertError } = await supabaseAdmin
          .from('customers')
          .insert({
            workspace_id: body.workspaceId,
            client_user_id: body.clientUserId,
            stripe_customer_id: stripeCustomer.id,
            default_currency: body.currency,
            billing_email: billingEmail,
          })
          .select()
          .single()

        if (insertError || !newCustomer) {
          throw new Error(
            insertError?.message ?? 'Failed to save customer with Stripe ID',
          )
        }

        customer = newCustomer
      }
    } else {
      if (customer.billing_email !== billingEmail) {
        await StripeConnector.updateCustomerEmail(
          customer.stripe_customer_id,
          billingEmail,
        )
      }

      if (
        customer.client_user_id !== body.clientUserId ||
        customer.billing_email !== billingEmail
      ) {
        const { data: updatedCustomer, error: updateError } = await supabaseAdmin
          .from('customers')
          .update({
            client_user_id: body.clientUserId,
            billing_email: billingEmail,
          })
          .eq('id', customer.id)
          .select()
          .single()

        if (updateError || !updatedCustomer) {
          throw new Error(
            updateError?.message ?? 'Failed to update customer billing details',
          )
        }

        customer = updatedCustomer
      }
    }

    if (!customer?.stripe_customer_id) {
      throw new Error('Customer missing Stripe ID')
    }

    if (body.type === 'retainer') {
      const { subscription, invoice: stripeInvoice } = await StripeConnector.createRetainer({
        stripeCustomerId: customer.stripe_customer_id,
        workspaceId: body.workspaceId,
        currency: body.currency,
        amount: body.amount,
        productName: body.description ?? 'Monthly Retainer',
        dayOfMonth: body.dayOfMonth,
      })

      const { periodStart, periodEnd } = getSubscriptionPeriod(subscription)
      const billingDayFromPeriod = periodStart
        ? Math.min(new Date(periodStart * 1000).getUTCDate(), 28)
        : null
      const billingDay = body.dayOfMonth ?? billingDayFromPeriod ??
        Math.min(new Date().getUTCDate(), 28)

      const { data: sub, error: subError } = await supabaseAdmin
        .from('subscriptions')
        .insert({
          workspace_id: body.workspaceId,
          client_user_id: body.clientUserId,
          description: body.description ?? 'Monthly Retainer',
          provider: 'stripe',
          provider_subscription_id: subscription.id,
          amount: body.amount,
          currency: body.currency,
          interval: 'month',
          day_of_month: billingDay,
          status: 'active',
          billing_paused: false,
          current_period_start: periodStart
            ? new Date(periodStart * 1000).toISOString()
            : null,
          current_period_end: periodEnd
            ? new Date(periodEnd * 1000).toISOString()
            : null,
        })
        .select()
        .single()

      if (subError || !sub) {
        throw new Error(subError?.message ?? 'Failed to save subscription')
      }

      if (!stripeInvoice) {
        return jsonResponse({ subscription: sub }, 200)
      }

      const dueDate = stripeInvoice.due_date
        ? new Date(stripeInvoice.due_date * 1000).toISOString().slice(0, 10)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const { data: invoice, error: invoiceError } = await supabaseAdmin
        .from('invoices')
        .insert({
          workspace_id: body.workspaceId,
          client_user_id: body.clientUserId,
          type: 'retainer',
          status: stripeInvoice.status === 'paid' ? 'paid' : 'open',
          provider: 'stripe',
          provider_invoice_id: stripeInvoice.id,
          subscription_id: sub.id,
          currency: body.currency,
          subtotal: stripeInvoice.subtotal ?? 0,
          tax_total: stripeInvoice.tax ?? 0,
          total: stripeInvoice.total ?? 0,
          amount_paid: stripeInvoice.amount_paid ?? 0,
          due_date: dueDate,
          issued_at: new Date().toISOString(),
          hosted_url: stripeInvoice.hosted_invoice_url ?? undefined,
          pdf_url: stripeInvoice.invoice_pdf ?? undefined,
        })
        .select()
        .single()

      if (invoiceError || !invoice) {
        throw new Error(invoiceError?.message ?? 'Failed to save retainer invoice')
      }

      const { error: lineItemsError } = await supabaseAdmin.from('line_items').insert({
        workspace_id: body.workspaceId,
        invoice_id: invoice.id,
        description: body.description ?? 'Monthly Retainer',
        quantity: 1,
        unit_amount: body.amount,
      })

      if (lineItemsError) {
        throw new Error(lineItemsError.message)
      }

      queueInvoiceEmail(stripeInvoice.id)
      return jsonResponse({ subscription: sub, invoice }, 200)
    }

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

    const dueDate = stripeInvoice.due_date
      ? new Date(stripeInvoice.due_date * 1000).toISOString().slice(0, 10)
      : new Date(
          Date.now() + (body.daysUntilDue ?? 14) * 24 * 60 * 60 * 1000,
        ).toISOString().slice(0, 10)

    const { data: invoice, error: invoiceError } = await supabaseAdmin
      .from('invoices')
      .insert({
        workspace_id: body.workspaceId,
        client_user_id: body.clientUserId,
        type: 'one_off',
        status: 'open',
        provider: 'stripe',
        provider_invoice_id: stripeInvoice.id,
        currency: body.currency,
        subtotal: stripeInvoice.subtotal ?? 0,
        tax_total: stripeInvoice.tax ?? 0,
        total: stripeInvoice.total ?? 0,
        due_date: dueDate,
        issued_at: new Date().toISOString(),
        hosted_url: stripeInvoice.hosted_invoice_url ?? undefined,
        pdf_url: stripeInvoice.invoice_pdf ?? undefined,
      })
      .select()
      .single()

    if (invoiceError || !invoice) {
      throw new Error(invoiceError?.message ?? 'Failed to save invoice')
    }

    const { error: lineItemsError } = await supabaseAdmin.from('line_items').insert(
      lines.map((line) => ({
        workspace_id: body.workspaceId,
        invoice_id: invoice.id,
        description: line.description,
        quantity: line.quantity,
        unit_amount: line.unitAmount,
      })),
    )

    if (lineItemsError) {
      throw new Error(lineItemsError.message)
    }

    queueInvoiceEmail(stripeInvoice.id)
    return jsonResponse({ invoice }, 200)
  } catch (err) {
    console.error('Create invoice/subscription error:', err)
    const message = err instanceof Error ? err.message : 'Internal server error'
    const status = message.includes('not a member') ||
        message.includes('workspace clients') ||
        message.includes('does not have an email')
      ? 400
      : 500
    return jsonResponse({ error: message }, status)
  }
})
