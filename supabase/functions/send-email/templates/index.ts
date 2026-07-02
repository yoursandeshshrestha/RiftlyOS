import type { EmailPayloadMap, EmailTemplateId, RenderedEmail } from '../_shared/types.ts'
import { renderWelcomeUser } from './welcome-user.ts'
import { renderWorkspaceInvite } from './workspace-invite.ts'
import { renderTaskAssigned } from './task-assigned.ts'

type TemplateRenderer = (payload: EmailPayloadMap[EmailTemplateId]) => RenderedEmail

const registry: Record<EmailTemplateId, TemplateRenderer> = {
  'welcome-user': (payload) => renderWelcomeUser(payload as EmailPayloadMap['welcome-user']),
  'workspace-invite': (payload) => renderWorkspaceInvite(payload as EmailPayloadMap['workspace-invite']),
  'task-assigned': (payload) => renderTaskAssigned(payload as EmailPayloadMap['task-assigned']),
}

export function isValidTemplateId(value: string): value is EmailTemplateId {
  return value in registry
}

export function renderEmailTemplate(
  template: EmailTemplateId,
  payload: EmailPayloadMap[EmailTemplateId],
): RenderedEmail {
  const renderer = registry[template]
  if (!renderer) {
    throw new Error(`Unknown email template: ${template}`)
  }
  return renderer(payload)
}

export const EMAIL_TEMPLATE_IDS = Object.keys(registry) as EmailTemplateId[]
