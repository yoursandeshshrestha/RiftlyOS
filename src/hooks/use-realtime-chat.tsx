import { useCallback, useEffect, useState } from 'react'

import { createClient } from '@/lib/supabase/client'

interface UseRealtimeChatProps {
  roomName: string
  username: string
  userId?: string
  onPersistMessage?: (content: string) => Promise<string | void>
}

export interface ChatMessage {
  id: string
  content: string
  user: {
    id?: string
    name: string
  }
  createdAt: string
}

const EVENT_MESSAGE_TYPE = 'message'

export function useRealtimeChat({
  roomName,
  username,
  userId,
  onPersistMessage,
}: UseRealtimeChatProps) {
  const supabase = createClient()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [channel, setChannel] = useState<ReturnType<typeof supabase.channel> | null>(null)
  const [isConnected, setIsConnected] = useState(false)

  useEffect(() => {
    const newChannel = supabase.channel(roomName)

    newChannel
      .on('broadcast', { event: EVENT_MESSAGE_TYPE }, (payload) => {
        setMessages((current) => [...current, payload.payload as ChatMessage])
      })
      .subscribe(async (status) => {
        setIsConnected(status === 'SUBSCRIBED')
      })

    setChannel(newChannel)

    return () => {
      supabase.removeChannel(newChannel)
    }
  }, [roomName, supabase])

  const sendMessage = useCallback(
    async (content: string) => {
      if (!channel || !isConnected) return

      let messageId: string = crypto.randomUUID()

      if (onPersistMessage) {
        const persistedId = await onPersistMessage(content)
        if (persistedId) {
          messageId = persistedId
        }
      }

      const message: ChatMessage = {
        id: messageId,
        content,
        user: {
          id: userId,
          name: username,
        },
        createdAt: new Date().toISOString(),
      }

      setMessages((current) => [...current, message])

      await channel.send({
        type: 'broadcast',
        event: EVENT_MESSAGE_TYPE,
        payload: message,
      })
    },
    [channel, isConnected, onPersistMessage, userId, username]
  )

  return { messages, sendMessage, isConnected }
}
