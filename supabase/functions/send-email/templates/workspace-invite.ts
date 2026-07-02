import type { RenderedEmail, WorkspaceInvitePayload } from '../_shared/types.ts'
import { emailLayout, escapeHtml } from '../_shared/layout.ts'

export function renderWorkspaceInvite(payload: WorkspaceInvitePayload): RenderedEmail {
  const subject = `You're invited to ${payload.workspaceName}`

  const html = emailLayout(
    `
      <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b;">You're invited</p>
      <p style="margin:0 0 12px;">
        <strong>${escapeHtml(payload.inviterName)}</strong> invited you to join
        <strong>${escapeHtml(payload.workspaceName)}</strong> on Agency OS.
      </p>
      <p style="margin:0 0 8px;">Use this invite code when signing up:</p>
      <p style="margin:0 0 16px;padding:14px 16px;background:#f4f4f5;border-radius:8px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:18px;font-weight:700;letter-spacing:0.08em;color:#18181b;">
        ${escapeHtml(payload.inviteCode)}
      </p>
      <p style="margin:0;color:#71717a;font-size:14px;">Create an account, then enter the code on the join workspace screen.</p>
    `,
    `Join ${payload.workspaceName} on Agency OS`,
  )

  return { subject, html }
}
