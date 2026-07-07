export type EmailDeliveryStatus = 'pending' | 'sent' | 'failed'

export interface EmailDelivery {
  id: string
  workspace_id: string | null
  template: string
  recipient: string
  payload: Record<string, unknown>
  status: EmailDeliveryStatus
  subject: string | null
  resend_id: string | null
  error_message: string | null
  retry_count: number
  last_retry_at: string | null
  created_by: string | null
  created_at: string
  sent_at: string | null
  updated_at: string
  creator?: {
    full_name: string
    email: string
  } | null
}

export const EMAIL_TEMPLATE_LABELS: Record<string, string> = {
  'welcome-user': 'Welcome user',
  'workspace-invite': 'Workspace invite',
  'task-assigned': 'Task assigned',
  'test-email': 'Test email',
}
