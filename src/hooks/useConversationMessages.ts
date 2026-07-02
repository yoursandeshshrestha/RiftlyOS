import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { ChatMessage, ConversationTarget } from '@/lib/messaging/types'
import { markConversationRead } from '@/lib/messaging/readState'

interface UseConversationMessagesOptions {
  target: ConversationTarget | null
  userId: string | undefined
}

export function useConversationMessages({ target, userId }: UseConversationMessagesOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  const loadMessages = useCallback(async () => {
    if (!target) {
      setMessages([])
      return
    }

    setLoading(true)
    setError(null)

    let query = supabase
      .from('messages')
      .select(`
        id,
        body,
        sender_id,
        created_at,
        profiles!messages_sender_id_fkey (
          full_name,
          avatar_url
        )
      `)
      .eq('workspace_id', target.workspaceId)
      .order('created_at', { ascending: true })

    if (target.type === 'channel') {
      query = query.eq('channel_id', target.channelId)
    } else {
      query = query.eq('direct_message_id', target.directMessageId)
    }

    const { data, error: fetchError } = await query

    if (fetchError) {
      console.error('Failed to load messages:', fetchError)
      setError('Failed to load messages')
      setMessages([])
    } else {
      const mapped = (data ?? []).map((row) => {
        const profile = row.profiles as { full_name: string | null; avatar_url: string | null } | null
        return {
          id: row.id,
          body: row.body,
          sender_id: row.sender_id,
          created_at: row.created_at,
          sender: profile
            ? { full_name: profile.full_name, avatar_url: profile.avatar_url }
            : undefined,
        } satisfies ChatMessage
      })
      setMessages(mapped)
    }

    setLoading(false)
  }, [target])

  useEffect(() => {
    void loadMessages()
  }, [loadMessages])

  useEffect(() => {
    if (!loading && messages.length > 0) {
      scrollToBottom()
    }
  }, [loading, messages.length, scrollToBottom])

  useEffect(() => {
    if (!target || !userId) return

    void markConversationRead({
      userId,
      channelId: target.type === 'channel' ? target.channelId : undefined,
      directMessageId: target.type === 'dm' ? target.directMessageId : undefined,
    })
  }, [target, userId, messages.length])

  useEffect(() => {
    if (!target) return

    const filter =
      target.type === 'channel'
        ? `channel_id=eq.${target.channelId}`
        : `direct_message_id=eq.${target.directMessageId}`

    const topic = `messages-${target.type}-${target.type === 'channel' ? target.channelId : target.directMessageId}`
    const stale = supabase.getChannels().find((ch) => ch.topic === `realtime:${topic}`)
    if (stale) {
      supabase.removeChannel(stale)
    }

    const subscription = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter },
        async (payload) => {
          const row = payload.new as {
            id: string
            body: string
            sender_id: string
            created_at: string
          }

          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name, avatar_url')
            .eq('id', row.sender_id)
            .maybeSingle()

          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev
            return [
              ...prev,
              {
                id: row.id,
                body: row.body,
                sender_id: row.sender_id,
                created_at: row.created_at,
                sender: profile
                  ? { full_name: profile.full_name, avatar_url: profile.avatar_url }
                  : undefined,
              },
            ]
          })

          if (userId) {
            void markConversationRead({
              userId,
              channelId: target.type === 'channel' ? target.channelId : undefined,
              directMessageId: target.type === 'dm' ? target.directMessageId : undefined,
            })
          }

          scrollToBottom()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(subscription)
    }
  }, [target, userId, scrollToBottom])

  const sendMessage = useCallback(
    async (body: string) => {
      const trimmed = body.trim()
      if (!trimmed || !target || !userId || sending) return false

      setSending(true)
      setError(null)

      const insert = {
        workspace_id: target.workspaceId,
        sender_id: userId,
        body: trimmed,
        channel_id: target.type === 'channel' ? target.channelId : null,
        direct_message_id: target.type === 'dm' ? target.directMessageId : null,
      }

      const { error: sendError } = await supabase.from('messages').insert(insert)

      if (sendError) {
        console.error('Failed to send message:', sendError)
        setError('Failed to send message')
        setSending(false)
        return false
      }

      setSending(false)
      return true
    },
    [target, userId, sending]
  )

  const persistMessage = useCallback(
    async (body: string) => {
      const trimmed = body.trim()
      if (!trimmed || !target || !userId) return

      const insert = {
        workspace_id: target.workspaceId,
        sender_id: userId,
        body: trimmed,
        channel_id: target.type === 'channel' ? target.channelId : null,
        direct_message_id: target.type === 'dm' ? target.directMessageId : null,
      }

      const { data, error: sendError } = await supabase
        .from('messages')
        .insert(insert)
        .select('id')
        .single()

      if (sendError) {
        console.error('Failed to send message:', sendError)
        setError('Failed to send message')
        return
      }

      return data.id
    },
    [target, userId]
  )

  return {
    messages,
    loading,
    sending,
    error,
    sendMessage,
    persistMessage,
    bottomRef,
    scrollToBottom,
  }
}
