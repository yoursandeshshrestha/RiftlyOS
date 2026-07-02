export type EmailTemplateId =
  | 'welcome-user'
  | 'workspace-invite'
  | 'task-assigned'

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

export type EmailPayloadMap = {
  'welcome-user': WelcomeUserPayload
  'workspace-invite': WorkspaceInvitePayload
  'task-assigned': TaskAssignedPayload
}

export interface QueueEmailResponse {
  queued: boolean
  emailId?: string
  status?: string
  error?: string
}

export interface QueueEmailOptions {
  workspaceId?: string
}
