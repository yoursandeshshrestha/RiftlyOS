/**
 * Stripe connector - provider abstraction for Stripe payment operations.
 * All Stripe SDK calls are isolated here for future multi-provider support.
 */

import Stripe from 'npm:stripe@17.5.0'
import { env } from './env.ts'

// Lazy-load Stripe client
let stripeClient: Stripe | null = null

function getStripeClient(): Stripe {
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY(), {
      apiVersion: '2024-12-18.acacia',
      httpClient: Stripe.createFetchHttpClient(),
    })
  }
  return stripeClient
}

export interface CreateCustomerInput {
  workspaceId: string
  clientUserId?: string
  name: string
  email?: string
  vatNumber?: string | null
  currency: string
}

export interface OneOffLineInput {
  description: string
  quantity: number
  unitAmount: number // minor units
}

export function getSubscriptionPeriod(subscription: Stripe.Subscription): {
  periodStart: number | null
  periodEnd: number | null
} {
  if (subscription.current_period_start && subscription.current_period_end) {
    return {
      periodStart: subscription.current_period_start,
      periodEnd: subscription.current_period_end,
    }
  }

  const item = subscription.items?.data?.[0]
  if (item?.current_period_start && item?.current_period_end) {
    return {
      periodStart: item.current_period_start,
      periodEnd: item.current_period_end,
    }
  }

  return { periodStart: null, periodEnd: null }
}

async function finalizeInvoice(
  stripe: Stripe,
  invoiceRef: string | Stripe.Invoice,
): Promise<Stripe.Invoice> {
  const invoiceId = typeof invoiceRef === 'string' ? invoiceRef : invoiceRef.id
  const invoice = typeof invoiceRef === 'string'
    ? await stripe.invoices.retrieve(invoiceId)
    : invoiceRef

  if (invoice.status === 'draft') {
    return stripe.invoices.finalizeInvoice(invoiceId, { auto_advance: true })
  }

  return invoice
}

export const StripeConnector = {
  /**
   * Create a Stripe Customer and tag with workspace_id for reverse-mapping
   */
  async createCustomer(input: CreateCustomerInput): Promise<Stripe.Customer> {
    if (!input.email?.trim()) {
      throw new Error(
        'Billing email is required to create a Stripe customer for invoicing.',
      )
    }

    const stripe = getStripeClient()
    return stripe.customers.create({
      name: input.name,
      email: input.email.trim(),
      metadata: {
        workspace_id: input.workspaceId,
        ...(input.clientUserId ? { client_user_id: input.clientUserId } : {}),
      },
      ...(input.vatNumber
        ? { tax_id_data: [{ type: 'gb_vat', value: input.vatNumber }] }
        : {}),
    })
  },

  async updateCustomerEmail(
    stripeCustomerId: string,
    email: string,
  ): Promise<void> {
    const stripe = getStripeClient()
    await stripe.customers.update(stripeCustomerId, { email: email.trim() })
  },

  /**
   * Email the invoice to the customer. Safe to run in the background after responding.
   */
  async sendInvoice(invoiceId: string): Promise<void> {
    const stripe = getStripeClient()
    const invoice = await stripe.invoices.retrieve(invoiceId)
    if (invoice.status === 'open') {
      await stripe.invoices.sendInvoice(invoiceId)
    }
  },

  /**
   * Create a one-off invoice, finalize it, and return without waiting on email delivery.
   */
  async createOneOffInvoice(args: {
    stripeCustomerId: string
    workspaceId: string
    currency: string
    lines: OneOffLineInput[]
    daysUntilDue: number
  }): Promise<Stripe.Invoice> {
    const stripe = getStripeClient()

    const invoice = await stripe.invoices.create({
      customer: args.stripeCustomerId,
      currency: args.currency,
      collection_method: 'send_invoice',
      days_until_due: args.daysUntilDue,
      auto_advance: false,
      metadata: { workspace_id: args.workspaceId },
    })

    await Promise.all(
      args.lines.map((line) =>
        stripe.invoiceItems.create({
          customer: args.stripeCustomerId,
          invoice: invoice.id,
          currency: args.currency,
          quantity: line.quantity,
          unit_amount: line.unitAmount,
          description: line.description,
        })
      ),
    )

    return finalizeInvoice(stripe, invoice)
  },

  /**
   * Create a monthly recurring subscription (retainer).
   * Finalizes the first invoice but does not block on email delivery.
   */
  async createRetainer(args: {
    stripeCustomerId: string
    workspaceId: string
    currency: string
    amount: number // minor units / month
    productName: string
    dayOfMonth?: number
  }): Promise<{ subscription: Stripe.Subscription; invoice: Stripe.Invoice | null }> {
    const stripe = getStripeClient()

    const price = await stripe.prices.create({
      currency: args.currency,
      unit_amount: args.amount,
      recurring: { interval: 'month' },
      product_data: { name: args.productName },
    })

    const subscription = await stripe.subscriptions.create({
      customer: args.stripeCustomerId,
      items: [{ price: price.id }],
      collection_method: 'send_invoice',
      days_until_due: 7,
      metadata: { workspace_id: args.workspaceId },
      expand: ['latest_invoice', 'items.data'],
      ...(args.dayOfMonth
        ? { billing_cycle_anchor_config: { day_of_month: args.dayOfMonth } }
        : {}),
    })

    let invoice: Stripe.Invoice | null = null
    if (subscription.latest_invoice) {
      invoice = await finalizeInvoice(stripe, subscription.latest_invoice)
    }

    return { subscription, invoice }
  },

  async pauseSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = getStripeClient()
    return stripe.subscriptions.update(stripeSubscriptionId, {
      pause_collection: { behavior: 'void' },
    })
  },

  async resumeSubscription(stripeSubscriptionId: string): Promise<Stripe.Subscription> {
    const stripe = getStripeClient()
    return stripe.subscriptions.update(stripeSubscriptionId, {
      pause_collection: '',
    })
  },

  /**
   * Verify a webhook signature and return the parsed event (throws on tamper)
   */
  async verifyWebhook(
    rawBody: string,
    signature: string,
    secret: string,
  ): Promise<Stripe.Event> {
    const stripe = getStripeClient()
    return stripe.webhooks.constructEventAsync(rawBody, signature, secret)
  },
}

export type PaymentProvider = typeof StripeConnector
