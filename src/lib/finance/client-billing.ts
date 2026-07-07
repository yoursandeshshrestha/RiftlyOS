import { supabase } from '../supabase'

export async function getCustomerBillingEmailMap(
  workspaceId: string,
  clientUserIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (clientUserIds.length === 0) return map

  const { data, error } = await supabase
    .from('customers')
    .select('client_user_id, billing_email')
    .eq('workspace_id', workspaceId)
    .in('client_user_id', clientUserIds)

  if (error) throw error

  for (const customer of data ?? []) {
    if (customer.client_user_id && customer.billing_email?.trim()) {
      map.set(customer.client_user_id, customer.billing_email.trim())
    }
  }

  return map
}
