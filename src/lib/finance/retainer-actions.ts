import { supabase } from '../supabase'

export type RetainerBillingAction = 'pause' | 'resume'

export async function updateRetainerBilling(
  subscriptionId: string,
  workspaceId: string,
  action: RetainerBillingAction,
): Promise<void> {
  const {
    data: { session },
  } = await supabase.auth.getSession()

  if (!session?.access_token) {
    throw new Error('Not authenticated')
  }

  const response = await supabase.functions.invoke('manage-subscription', {
    body: {
      workspaceId,
      subscriptionId,
      action,
    },
  })

  if (response.error) {
    throw new Error(response.error.message || 'Failed to update retainer')
  }

  const payload = response.data as { error?: string } | null
  if (payload?.error) {
    throw new Error(payload.error)
  }
}
