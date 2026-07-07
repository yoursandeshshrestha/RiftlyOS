import { supabase } from '../supabase'
import type { Database } from '../database.types'
import { getCustomerBillingEmailMap } from './client-billing'

type Invoice = Database['public']['Tables']['invoices']['Row']

export interface InvoiceListItem extends Invoice {
  clientName: string | null
  clientEmail: string | null
  billingEmail: string | null
  description: string | null
}

type InvoiceWithLineItems = Invoice & {
  line_items: { description: string }[] | null
}

export async function getInvoicesWithDetails(
  workspaceId: string,
  limit = 500,
): Promise<{ invoices: InvoiceListItem[]; count: number }> {
  const { data, error, count } = await supabase
    .from('invoices')
    .select(
      `
        *,
        line_items (
          description
        )
      `,
      { count: 'exact' },
    )
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw error

  const rows = (data ?? []) as InvoiceWithLineItems[]
  const clientIds = [
    ...new Set(rows.map((row) => row.client_user_id).filter((id): id is string => Boolean(id))),
  ]

  const profileMap = new Map<string, { full_name: string; email: string }>()
  let billingMap = new Map<string, string>()

  if (clientIds.length > 0) {
    const [profilesResult, billingEmailMap] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email').in('id', clientIds),
      getCustomerBillingEmailMap(workspaceId, clientIds),
    ])

    if (profilesResult.error) throw profilesResult.error

    for (const profile of profilesResult.data ?? []) {
      profileMap.set(profile.id, profile)
    }

    billingMap = billingEmailMap
  }

  const invoices = rows.map((row) => {
    const { line_items: lineItems, ...invoice } = row
    const profile = invoice.client_user_id ? profileMap.get(invoice.client_user_id) : null

    return {
      ...invoice,
      clientName: profile?.full_name ?? null,
      clientEmail: profile?.email ?? null,
      billingEmail: invoice.client_user_id ? billingMap.get(invoice.client_user_id) ?? null : null,
      description: lineItems?.[0]?.description ?? null,
    }
  })

  return { invoices, count: count ?? 0 }
}
