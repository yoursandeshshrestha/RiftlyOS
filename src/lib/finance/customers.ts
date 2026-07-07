/**
 * Customer management functions
 */

import { supabase } from '../supabase'
import type { Database } from '../database.types'

type Customer = Database['public']['Tables']['customers']['Row']
type CustomerInsert = Database['public']['Tables']['customers']['Insert']

/**
 * Get or create customer record for a workspace
 * Note: Stripe customer creation happens server-side via Edge Function
 */
export async function getCustomer(workspaceId: string): Promise<Customer | null> {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()

  if (error && error.code !== 'PGRST116') {
    // PGRST116 = no rows returned
    throw error
  }

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
    billing_address?: Record<string, unknown>
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
