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

export const StripeConnector = {
  /**
   * Create a Stripe Customer and tag with workspace_id for reverse-mapping
   */
  async createCustomer(input: CreateCustomerInput): Promise<Stripe.Customer> {
    const stripe = getStripeClient()
    return stripe.customers.create({
      name: input.name,
      email: input.email,
      currency: input.currency,
      metadata: { workspace_id: input.workspaceId },
      ...(input.vatNumber
        ? { tax_id_data: [{ type: 'gb_vat', value: input.vatNumber }] }
        : {}),
    })
  },

  /**
   * Create a one-off invoice: attach InvoiceItems, create with auto-tax, finalize, send
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
      automatic_tax: { enabled: true }, // Stripe Tax → UK VAT / reverse-charge
      metadata: { workspace_id: args.workspaceId },
    })

    for (const line of args.lines) {
      await stripe.invoiceItems.create({
        customer: args.stripeCustomerId,
        invoice: invoice.id,
        currency: args.currency,
        quantity: line.quantity,
        unit_amount: line.unitAmount,
        description: line.description,
      })
    }

    const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
      auto_advance: true,
    })
    await stripe.invoices.sendInvoice(finalized.id)
    return stripe.invoices.retrieve(finalized.id)
  },

  /**
   * Create a monthly recurring subscription (retainer) on a created Price
   */
  async createRetainer(args: {
    stripeCustomerId: string
    workspaceId: string
    currency: string
    amount: number // minor units / month
    productName: string
    dayOfMonth?: number
  }): Promise<Stripe.Subscription> {
    const stripe = getStripeClient()

    const price = await stripe.prices.create({
      currency: args.currency,
      unit_amount: args.amount,
      recurring: { interval: 'month' },
      product_data: { name: args.productName },
    })

    return stripe.subscriptions.create({
      customer: args.stripeCustomerId,
      items: [{ price: price.id }],
      collection_method: 'send_invoice',
      days_until_due: 7,
      automatic_tax: { enabled: true },
      metadata: { workspace_id: args.workspaceId },
      ...(args.dayOfMonth
        ? { billing_cycle_anchor_config: { day_of_month: args.dayOfMonth } }
        : {}),
    })
  },

  /**
   * Verify a webhook signature and return the parsed event (throws on tamper)
   */
  verifyWebhook(
    rawBody: string,
    signature: string,
    secret: string,
  ): Stripe.Event {
    const stripe = getStripeClient()
    return stripe.webhooks.constructEvent(rawBody, signature, secret)
  },
}

export type PaymentProvider = typeof StripeConnector
