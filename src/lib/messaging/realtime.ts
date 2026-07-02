import type { ChatMessage as RealtimeChatMessage } from '@/hooks/use-realtime-chat'
import type { ChatMessage as DbChatMessage, ConversationTarget } from '@/lib/messaging/types'

export function getConversationRoomName(target: ConversationTarget): string {
  if (target.type === 'channel') {
    return `channel-${target.channelId}`
  }
  return `dm-${target.directMessageId}`
}

export function mapDbMessageToRealtimeMessage(message: DbChatMessage): RealtimeChatMessage {
  return {
    id: message.id,
    content: message.body,
    user: {
      id: message.sender_id,
      name: message.sender?.full_name ?? 'Unknown',
    },
    createdAt: message.created_at,
  }
}
