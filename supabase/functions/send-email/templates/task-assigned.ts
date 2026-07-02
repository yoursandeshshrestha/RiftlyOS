import type { RenderedEmail, TaskAssignedPayload } from '../_shared/types.ts'
import { button, emailLayout, escapeHtml } from '../_shared/layout.ts'

export function renderTaskAssigned(payload: TaskAssignedPayload): RenderedEmail {
  const projectLine = payload.projectName
    ? `<p style="margin:0 0 12px;color:#71717a;">Project: <strong style="color:#3f3f46;">${escapeHtml(payload.projectName)}</strong></p>`
    : ''

  const subject = `Task assigned: ${payload.taskTitle}`
  const taskUrl = payload.taskUrl ?? 'https://app.milktreeagency.com/tasks'

  const html = emailLayout(
    `
      <p style="margin:0 0 16px;font-size:20px;font-weight:600;color:#18181b;">Hi ${escapeHtml(payload.assigneeName)},</p>
      <p style="margin:0 0 12px;">A task has been assigned to you:</p>
      <p style="margin:0 0 12px;font-size:17px;font-weight:600;color:#18181b;">${escapeHtml(payload.taskTitle)}</p>
      ${projectLine}
      ${button(taskUrl, 'View task')}
    `,
    `New task: ${payload.taskTitle}`,
  )

  return { subject, html }
}
