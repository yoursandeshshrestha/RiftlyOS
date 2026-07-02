import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { supabase } from '@/lib/supabase'
import { parseMessageHash } from '@/lib/messaging/parseHash'
import type { ConversationMetadata, ConversationTarget } from '@/lib/messaging/types'
import { ChatArea } from './components/ChatArea'
import { ChatSkeleton } from './components/ChatSkeleton'

export default function Messages() {
  const { user } = useAuth()
  const { activeWorkspace } = useWorkspace()
  const location = useLocation()
  const [target, setTarget] = useState<ConversationTarget | null>(null)
  const [metadata, setMetadata] = useState<ConversationMetadata | null>(null)
  const [channelError, setChannelError] = useState<string | null>(null)
  const [isLoadingChannel, setIsLoadingChannel] = useState(false)

  const parsedHash = useMemo(
    () => parseMessageHash(location.hash),
    [location.hash]
  )

  useEffect(() => {
    if (!user?.id || !activeWorkspace?.id) {
      setTarget(null)
      setMetadata(null)
      return
    }

    if (!parsedHash) {
      setTarget(null)
      setMetadata(null)
      setChannelError(null)
      setIsLoadingChannel(false)
      return
    }

    let cancelled = false

    async function loadConversation() {
      setIsLoadingChannel(true)
      setChannelError(null)

      try {
        if (parsedHash!.kind === 'dm') {
          const otherUserId = parsedHash!.otherUserId

          const { data: dmData, error: dmError } = await supabase.rpc('get_or_create_dm_channel', {
            p_workspace_id: activeWorkspace!.id,
            p_user1_id: user!.id,
            p_user2_id: otherUserId,
          })

          if (dmError || !dmData?.length) {
            throw new Error('Failed to load direct message')
          }

          const dm = dmData[0]

          const { data: otherUserProfile, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .eq('id', otherUserId)
            .single()

          if (profileError || !otherUserProfile) {
            throw new Error('User not found')
          }

          if (cancelled) return

          setTarget({
            type: 'dm',
            directMessageId: dm.id,
            workspaceId: activeWorkspace!.id,
            otherUserId,
          })
          setMetadata({
            type: 'dm',
            directMessageId: dm.id,
            otherUserId,
            name: otherUserProfile.full_name || 'Unknown User',
          })
          return
        }

        const channelId = parsedHash!.channelId

        const { data: channelData, error: channelErr } = await supabase
          .from('channels')
          .select('id, name, workspace_id')
          .eq('id', channelId)
          .single()

        if (channelErr || !channelData) {
          throw new Error('Channel not found')
        }

        if (channelData.workspace_id !== activeWorkspace!.id) {
          throw new Error('You do not have access to this channel')
        }

        const { data: membership } = await supabase
          .from('channel_members')
          .select('id')
          .eq('channel_id', channelId)
          .eq('user_id', user!.id)
          .maybeSingle()

        if (!membership) {
          throw new Error('You do not have access to this channel')
        }

        const [memberCountResult, userRoleResult] = await Promise.all([
          supabase
            .from('channel_members')
            .select('*', { count: 'exact', head: true })
            .eq('channel_id', channelId),
          supabase
            .from('workspace_members')
            .select('role')
            .eq('workspace_id', activeWorkspace!.id)
            .eq('user_id', user!.id)
            .maybeSingle(),
        ])

        if (cancelled) return

        setTarget({
          type: 'channel',
          channelId,
          workspaceId: activeWorkspace!.id,
        })
        setMetadata({
          type: 'channel',
          channelId,
          name: channelData.name,
          memberCount: memberCountResult.count ?? 0,
          userRole: userRoleResult.data?.role,
        })
      } catch (err) {
        if (cancelled) return
        setTarget(null)
        setMetadata(null)
        setChannelError(err instanceof Error ? err.message : 'Failed to load conversation')
      } finally {
        if (!cancelled) setIsLoadingChannel(false)
      }
    }

    void loadConversation()

    return () => {
      cancelled = true
    }
  }, [parsedHash, user?.id, activeWorkspace?.id])

  useEffect(() => {
    if (!user?.id || !target || target.type !== 'channel') return

    const channelTopic = 'user-channel-membership'
    const staleChannel = supabase
      .getChannels()
      .find((ch) => ch.topic === `realtime:${channelTopic}`)
    if (staleChannel) {
      supabase.removeChannel(staleChannel)
    }

    const channelSubscription = supabase
      .channel(channelTopic)
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'channel_members',
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (payload.old.channel_id === target.channelId) {
            setTarget(null)
            setMetadata(null)
            setChannelError('You have been removed from this channel')
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channelSubscription)
    }
  }, [user?.id, target])

  return (
    <div className="flex h-full flex-col">
      {isLoadingChannel ? (
        <ChatSkeleton />
      ) : channelError ? (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <p className="mb-2 text-destructive">Error loading conversation</p>
            <p className="text-sm text-muted-foreground">{channelError}</p>
          </div>
        </div>
      ) : (
        <ChatArea target={target} metadata={metadata} />
      )}
    </div>
  )
}
