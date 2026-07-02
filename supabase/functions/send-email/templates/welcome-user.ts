import type { RenderedEmail, WelcomeUserPayload } from '../_shared/types.ts'
import { button, emailLayout, escapeHtml } from '../_shared/layout.ts'

export function renderWelcomeUser(payload: WelcomeUserPayload): RenderedEmail {
  const name = escapeHtml(payload.fullName)
  const workspaceLine = payload.workspaceName
    ? `<p>You've been added to <strong>${escapeHtml(payload.workspaceName)}</strong>.</p>`
    : ''

  const loginUrl = payload.loginUrl ?? 'https://app.milktreeagency.com/login'
  const subject = payload.workspaceName
    ? `Welcome to ${payload.workspaceName}`
    : 'Welcome to Agency OS'

  const html = emailLayout(
    `
      <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b;">Hi ${name},</p>
      <p style="margin:0 0 12px;">Your Agency OS account is ready.</p>
      ${workspaceLine}
      <p style="margin:0;">Sign in to view your workspace, tasks, and updates.</p>
      ${button(loginUrl, 'Sign in')}
    `,
    `Welcome to Agency OS, ${payload.fullName}`,
  )

  return { subject, html }
}
