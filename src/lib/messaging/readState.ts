import { supabase } from '@/lib/supabase'

export async function markConversationRead(params: {
  userId: string
  channelId?: string
  directMessageId?: string
}) {
  const now = new Date().toISOString()

  let query = supabase
    .from('message_read_states')
    .select('id')
    .eq('user_id', params.userId)

  if (params.channelId) {
    query = query.eq('channel_id', params.channelId)
  } else if (params.directMessageId) {
    query = query.eq('direct_message_id', params.directMessageId)
  } else {
    return
  }

  const { data: existing } = await query.maybeSingle()

  if (existing) {
    await supabase
      .from('message_read_states')
      .update({ last_read_at: now, updated_at: now })
      .eq('id', existing.id)
    return
  }

  await supabase.from('message_read_states').insert({
    user_id: params.userId,
    channel_id: params.channelId ?? null,
    direct_message_id: params.directMessageId ?? null,
    last_read_at: now,
    updated_at: now,
  })
}

export async function getChannelUnreadCount(channelId: string, userId: string) {
  const { data: readState } = await supabase
    .from('message_read_states')
    .select('last_read_at')
    .eq('user_id', userId)
    .eq('channel_id', channelId)
    .maybeSingle()

  const since = readState?.last_read_at ?? '1970-01-01T00:00:00Z'

  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .eq('channel_id', channelId)
    .gt('created_at', since)
    .neq('sender_id', userId)

  if (error) {
    console.error('Failed to fetch unread count:', error)
    return 0
  }

  return count ?? 0
}
