/**
 * Customer management functions
 */

import { supabase } from '../supabase'
import type { Database, Json } from '../database.types'

type Customer = Database['public']['Tables']['customers']['Row']
type CustomerInsert = Database['public']['Tables']['customers']['Insert']

/**
 * Get or create customer record for a workspace
 * Note: Stripe customer creation happens server-side via Edge Function
 */
export async function getCustomer(
  workspaceId: string,
  clientUserId?: string,
): Promise<Customer | null> {
  let query = supabase
    .from('customers')
    .select('*')
    .eq('workspace_id', workspaceId)

  if (clientUserId) {
    query = query.eq('client_user_id', clientUserId)
  }

  const { data, error } = await query.maybeSingle()

  if (error) throw error

  return data
}

/**
 * Create or update customer record (local only, Stripe sync happens via Edge Function)
 */
export async function upsertCustomer(customer: CustomerInsert): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .upsert(customer)
    .select()
    .single()

  if (error) throw error
  return data
}

/**
 * Update customer billing information
 */
export async function updateCustomerBilling(
  workspaceId: string,
  updates: {
    billing_email?: string
    vat_number?: string
    billing_address?: Json
  },
): Promise<Customer> {
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('workspace_id', workspaceId)
    .select()
    .single()

  if (error) throw error
  return data
}
