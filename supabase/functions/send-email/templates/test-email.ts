import type { RenderedEmail, TestEmailPayload } from '../_shared/types.ts'
import { emailLayout, escapeHtml } from '../_shared/layout.ts'

export function renderTestEmail(payload: TestEmailPayload): RenderedEmail {
  const workspaceName = payload.workspaceName?.trim() || 'your workspace'
  const sentAt = payload.sentAt?.trim() || new Date().toISOString()

  const subject = `Test email from ${workspaceName}`

  const html = emailLayout(
    `
      <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b;">Email delivery test</p>
      <p style="margin:0 0 12px;">This is a test email from <strong>${escapeHtml(workspaceName)}</strong>.</p>
      <p style="margin:0 0 12px;">If you received this message, outbound email is configured correctly.</p>
      <p style="margin:0;font-size:13px;color:#71717a;">Sent at ${escapeHtml(sentAt)}</p>
    `,
    `Test email from ${workspaceName}`,
  )

  return { subject, html }
}
