import { supabase } from '@/lib/supabase'
import type {
  EmailPayloadMap,
  EmailTemplateId,
  QueueEmailOptions,
  QueueEmailResponse,
} from './types'

/**
 * Queue an email for async delivery via the send-email Edge Function.
 * Returns as soon as the email is queued (HTTP 202) — Resend send happens in the background.
 */
export async function queueEmail<T extends EmailTemplateId>(
  template: T,
  to: string,
  payload: EmailPayloadMap[T],
  options?: QueueEmailOptions,
): Promise<QueueEmailResponse> {
  const { data, error } = await supabase.functions.invoke('send-email', {
    body: {
      template,
      to,
      payload,
      workspaceId: options?.workspaceId,
    },
  })

  if (error) {
    console.error('[queueEmail] invoke failed', { template, to, error })
    return { queued: false, error: error.message }
  }

  const response = data as QueueEmailResponse | null
  if (!response?.queued) {
    return {
      queued: false,
      error: (data as { error?: string } | null)?.error ?? 'Failed to queue email',
    }
  }

  return response
}

/**
 * Fire-and-forget wrapper — use when the UI should not wait on email delivery.
 */
export function queueEmailAsync<T extends EmailTemplateId>(
  template: T,
  to: string,
  payload: EmailPayloadMap[T],
  options?: QueueEmailOptions,
): void {
  void queueEmail(template, to, payload, options).catch((err) => {
    console.error('[queueEmailAsync] unhandled error', err)
  })
}

export type {
  EmailPayloadMap,
  EmailTemplateId,
  QueueEmailOptions,
  QueueEmailResponse,
  TaskAssignedPayload,
  WelcomeUserPayload,
  WorkspaceInvitePayload,
} from './types'
