export interface ChatMessage {
  id: string
  body: string
  sender_id: string
  created_at: string
  sender?: {
    full_name: string | null
    avatar_url: string | null
  }
}

export interface ConversationMetadata {
  type: 'channel' | 'dm'
  channelId?: string
  directMessageId?: string
  otherUserId?: string
  name?: string
  memberCount?: number
  userRole?: string
}

export type ConversationTarget =
  | { type: 'channel'; channelId: string; workspaceId: string }
  | { type: 'dm'; directMessageId: string; workspaceId: string; otherUserId: string }
