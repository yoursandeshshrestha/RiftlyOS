import { supabase } from '../supabase'
import type { Database } from '../database.types'
import { getCustomerBillingEmailMap } from './client-billing'

type Subscription = Database['public']['Tables']['subscriptions']['Row']

export interface RetainerListItem extends Subscription {
  clientName: string | null
  clientEmail: string | null
  billingEmail: string | null
}

export async function getRetainersWithDetails(
  workspaceId: string,
  limit = 500,
): Promise<{ retainers: RetainerListItem[]; count: number }> {
  const { data, error, count } = await supabase
    .from('subscriptions')
    .select('*', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = data ?? []
  const clientIds = [
    ...new Set(rows.map((row) => row.client_user_id).filter((id): id is string => Boolean(id))),
  ]

  const profileMap = new Map<string, { full_name: string; email: string }>()
  if (clientIds.length > 0) {
    const [{ data: profiles, error: profilesError }, billingMap] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').in('id', clientIds),
      getCustomerBillingEmailMap(workspaceId, clientIds),
    ])

    if (profilesError) throw profilesError

    for (const profile of profiles ?? []) {
      profileMap.set(profile.id, profile)
    }

    const retainers = rows.map((row) => {
      const profile = row.client_user_id ? profileMap.get(row.client_user_id) : null

      return {
        ...row,
        clientName: profile?.full_name ?? null,
        clientEmail: profile?.email ?? null,
        billingEmail: row.client_user_id ? billingMap.get(row.client_user_id) ?? null : null,
      }
    })

    return { retainers, count: count ?? 0 }
  }

  const retainers = rows.map((row) => ({
    ...row,
    clientName: null,
    clientEmail: null,
    billingEmail: null,
  }))

  return { retainers, count: count ?? 0 }
}
