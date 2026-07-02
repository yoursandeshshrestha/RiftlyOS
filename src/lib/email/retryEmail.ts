import { supabase } from '@/lib/supabase'

export interface RetryEmailResponse {
  queued: boolean
  emailId?: string
  status?: string
  retried?: boolean
  error?: string
}

export async function retryEmailDelivery(
  emailId: string,
  workspaceId: string,
): Promise<RetryEmailResponse> {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      action: 'retry',
      emailId,
      workspaceId,
    },
  })

  if (error) {
    console.error('[retryEmailDelivery] invoke failed', { emailId, error })
    return { queued: false, error: error.message }
  }

  const response = data as RetryEmailResponse | null
  if (!response?.queued) {
    return {
      queued: false,
      error: (data as { error?: string } | null)?.error ?? 'Failed to retry email',
    }
  }

  return response
}
