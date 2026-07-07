export type EmailTemplateId =
  | 'welcome-user'
  | 'workspace-invite'
  | 'task-assigned'
  | 'test-email'

export interface WelcomeUserPayload {
  fullName: string
  workspaceName?: string
  loginUrl?: string
}

export interface WorkspaceInvitePayload {
  inviterName: string
  workspaceName: string
  inviteCode: string
}

export interface TaskAssignedPayload {
  assigneeName: string
  taskTitle: string
  projectName?: string
  taskUrl?: string
}

export interface TestEmailPayload {
  workspaceName?: string
  sentAt?: string
}

export type EmailPayloadMap = {
  'welcome-user': WelcomeUserPayload
  'workspace-invite': WorkspaceInvitePayload
  'task-assigned': TaskAssignedPayload
  'test-email': TestEmailPayload
}

export interface SendEmailRequest {
  action?: 'send'
  template: EmailTemplateId
  to: string
  payload: EmailPayloadMap[EmailTemplateId]
  workspaceId?: string
}

export interface RetryEmailRequest {
  action: 'retry'
  emailId: string
  workspaceId: string
}

export type EmailRequestBody = SendEmailRequest | RetryEmailRequest

export interface RenderedEmail {
  subject: string
  html: string
}
