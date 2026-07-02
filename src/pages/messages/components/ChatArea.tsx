import { useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { useConversationMessages } from '@/hooks/useConversationMessages'
import { getConversationRoomName, mapDbMessageToRealtimeMessage } from '@/lib/messaging/realtime'
import type { ConversationMetadata, ConversationTarget } from '@/lib/messaging/types'
import { RealtimeChat } from '@/components/realtime-chat'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { HashIcon, SettingsIcon, UsersIcon, LoaderIcon } from '@/components/icons'
import { ManageChannelMembersDialog } from '@/components/layout/ManageChannelMembersDialog'

interface ChatAreaProps {
  target: ConversationTarget | null
  metadata: ConversationMetadata | null
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function ChatArea({ target, metadata }: ChatAreaProps) {
  const { user } = useAuth()
  const [isManagingMembers, setIsManagingMembers] = useState(false)

  const { messages, loading, error, persistMessage } = useConversationMessages({
    target,
    userId: user?.id,
  })

  const initialMessages = useMemo(
    () => messages.map(mapDbMessageToRealtimeMessage),
    [messages]
  )

  if (!target || !metadata) {
    return (
      <div className="flex h-full items-center justify-center bg-muted/20">
        <p className="text-muted-foreground">Select a channel or user to start messaging</p>
      </div>
    )
  }

  const isDirectMessage = metadata.type === 'dm'
  const displayName = isDirectMessage ? metadata.name ?? 'Direct Message' : metadata.name ?? 'Channel'
  const displayMemberCount = metadata.memberCount ?? 0
  const displayUserRole = metadata.userRole
  const username = user?.name ?? user?.email ?? 'You'

  return (
    <>
      <div className="flex items-center justify-between border-b px-6 py-4">
        <div className="flex min-w-0 items-center gap-2">
          {isDirectMessage ? (
            <>
              <Avatar className="size-6 shrink-0 rounded-md">
                <AvatarFallback className="rounded-md bg-muted text-[10px]">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <h1 className="truncate text-base font-semibold">{displayName}</h1>
            </>
          ) : (
            <>
              <HashIcon className="size-4 shrink-0 text-muted-foreground" />
              <h1 className="truncate text-base font-semibold">{displayName}</h1>
              {displayMemberCount > 0 && (
                <>
                  <span className="shrink-0 text-sm text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => displayUserRole === 'owner' && setIsManagingMembers(true)}
                    className={`flex shrink-0 items-center gap-1.5 text-sm text-muted-foreground transition-colors ${
                      displayUserRole === 'owner' ? 'cursor-pointer hover:text-foreground' : ''
                    }`}
                  >
                    <UsersIcon className="size-3.5" />
                    <span>{displayMemberCount}</span>
                  </button>
                </>
              )}
            </>
          )}
        </div>
        {displayUserRole === 'owner' && metadata.channelId && !isDirectMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsManagingMembers(true)}
            className="h-8 cursor-pointer"
          >
            <SettingsIcon className="size-4" />
          </Button>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {error && <p className="px-6 pt-4 text-sm text-destructive">{error}</p>}
            <RealtimeChat
              key={getConversationRoomName(target)}
              roomName={getConversationRoomName(target)}
              username={username}
              userId={user?.id}
              messages={initialMessages}
              onPersistMessage={persistMessage}
            />
          </>
        )}
      </div>

      {metadata.channelId && (
        <ManageChannelMembersDialog
          open={isManagingMembers}
          onOpenChange={setIsManagingMembers}
          channelId={metadata.channelId}
          channelName={metadata.name ?? 'Channel'}
        />
      )}
    </>
  )
}
