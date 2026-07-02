import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { sendViaResend } from './resend.ts'
import type { EmailTemplateId } from './types.ts'
import { isValidTemplateId, renderEmailTemplate } from '../templates/index.ts'

export async function processQueuedEmail(
  admin: SupabaseClient,
  emailId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: row, error: fetchError } = await admin
    .from('email_queue')
    .select('id, template, recipient, payload, status')
    .eq('id', emailId)
    .single()

  if (fetchError || !row) {
    console.error('[send-email] queue row not found', emailId, fetchError)
    return { ok: false, error: 'Email not found' }
  }

  if (row.status !== 'pending') {
    return { ok: false, error: `Cannot process email in status: ${row.status}` }
  }

  const template = row.template as EmailTemplateId
  if (!isValidTemplateId(template)) {
    await admin
      .from('email_queue')
      .update({
        status: 'failed',
        error_message: `Unknown template: ${row.template}`,
      })
      .eq('id', emailId)
    return { ok: false, error: `Unknown template: ${row.template}` }
  }

  try {
    const rendered = renderEmailTemplate(template, row.payload as never)
    const result = await sendViaResend({
      to: row.recipient,
      subject: rendered.subject,
      html: rendered.html,
    })

    await admin
      .from('email_queue')
      .update({
        status: 'sent',
        subject: rendered.subject,
        resend_id: result.id,
        sent_at: new Date().toISOString(),
        error_message: result.skipped ? 'RESEND_API_KEY not configured (dev skip)' : null,
      })
      .eq('id', emailId)

    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown send error'
    console.error('[send-email] failed', emailId, message)

    await admin
      .from('email_queue')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', emailId)

    return { ok: false, error: message }
  }
}

export async function retryQueuedEmail(
  admin: SupabaseClient,
  emailId: string,
  workspaceId: string,
): Promise<{ emailId: string }> {
  const { data: row, error: fetchError } = await admin
    .from('email_queue')
    .select('id, workspace_id, status, retry_count')
    .eq('id', emailId)
    .single()

  if (fetchError || !row) {
    throw new Error('Email delivery not found')
  }

  if (row.workspace_id !== workspaceId) {
    throw new Error('Email does not belong to this workspace')
  }

  if (row.status !== 'failed' && row.status !== 'pending') {
    throw new Error('Only failed or stuck pending emails can be retried')
  }

  const retryCount = (row.retry_count ?? 0) + 1

  const { error: updateError } = await admin
    .from('email_queue')
    .update({
      status: 'pending',
      error_message: null,
      resend_id: null,
      sent_at: null,
      retry_count: retryCount,
      last_retry_at: new Date().toISOString(),
    })
    .eq('id', emailId)

  if (updateError) {
    throw new Error(updateError.message)
  }

  return { emailId }
}
