/**
 * Finance metrics - MRR, outstanding, paid vs overdue, revenue vs target
 * These queries run client-side with RLS for workspace isolation
 */

import { supabase } from '../supabase'

/**
 * Monthly Recurring Revenue: sum of active subscription amounts (minor units)
 */
export async function getMRR(workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('amount')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active')
    .eq('billing_paused', false)

  if (error) {
    console.error('getMRR error:', error)
    throw error
  }

  return data?.reduce((total, sub) => total + (sub.amount || 0), 0) ?? 0
}

/**
 * Outstanding: unpaid balance on open + past_due invoices (total - amount_paid)
 */
export async function getOutstanding(workspaceId: string): Promise<number> {
  const { data, error } = await supabase
    .from('invoices')
    .select('total, amount_paid')
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'past_due'])

  if (error) {
    console.error('getOutstanding error:', error)
    throw error
  }

  return data?.reduce(
    (total, inv) => total + (inv.total - inv.amount_paid),
    0,
  ) ?? 0
}

/**
 * Paid vs overdue split (minor units)
 */
export async function getPaidVsOverdue(
  workspaceId: string,
): Promise<{ paid: number; overdue: number }> {
  const { data: paidData } = await supabase
    .from('invoices')
    .select('total')
    .eq('workspace_id', workspaceId)
    .eq('status', 'paid')

  const { data: overdueData } = await supabase
    .from('invoices')
    .select('total')
    .eq('workspace_id', workspaceId)
    .eq('status', 'past_due')

  const paid = paidData?.reduce((sum, inv) => sum + inv.total, 0) ?? 0
  const overdue = overdueData?.reduce((sum, inv) => sum + inv.total, 0) ?? 0

  return { paid, overdue }
}

/**
 * Recognised revenue for a period: paid invoices issued in that period
 */
export async function getRecognisedRevenue(
  workspaceId: string,
  periodStart: Date,
  periodEnd: Date,
): Promise<number> {
  const { data, error } = await supabase
    .from('invoices')
    .select('amount_paid')
    .eq('workspace_id', workspaceId)
    .eq('status', 'paid')
    .gte('paid_at', periodStart.toISOString())
    .lt('paid_at', periodEnd.toISOString())

  if (error) {
    console.error('getRecognisedRevenue error:', error)
    throw error
  }

  return data?.reduce((total, inv) => total + inv.amount_paid, 0) ?? 0
}

/**
 * Current month's target for the workspace (minor units), or null if unset
 */
export async function getRevenueTarget(
  workspaceId: string,
  period: string, // YYYY-MM-01 format
): Promise<number | null> {
  const { data, error } = await supabase
    .from('revenue_targets')
    .select('target_amount')
    .eq('workspace_id', workspaceId)
    .eq('month', period)
    .maybeSingle()

  if (error || !data) return null

  return Math.round(Number(data.target_amount) * 100)
}

/**
 * Get all invoices for a workspace with pagination
 */
export async function getInvoices(
  workspaceId: string,
  limit = 50,
  offset = 0,
) {
  const { data, error, count } = await supabase
    .from('invoices')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (error) throw error

  return { invoices: data ?? [], count: count ?? 0 }
}

/**
 * Get invoice with line items
 */
export async function getInvoiceWithLines(invoiceId: string) {
  const { data: invoice, error: invoiceError } = await supabase
    .from('invoices')
    .select('*')
    .eq('id', invoiceId)
    .single()

  if (invoiceError) throw invoiceError

  const { data: lines, error: linesError } = await supabase
    .from('line_items')
    .select('*')
    .eq('invoice_id', invoiceId)

  if (linesError) throw linesError

  return { invoice, lines: lines ?? [] }
}
