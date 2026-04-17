import { useState, useEffect } from 'react';
import { Channel as StreamChannel } from 'stream-chat';
import {
  Channel,
  MessageInput,
  MessageList,
  Thread,
  Window,
} from 'stream-chat-react';
import 'stream-chat-react/dist/css/v2/index.css';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { HashIcon, SettingsIcon, UsersIcon } from '@/components/icons';
import { ManageChannelMembersDialog } from '@/components/layout/ManageChannelMembersDialog';

interface ChannelMetadata {
  type: 'channel' | 'dm';
  name?: string;
  userName?: string;
  userAvatar?: string;
  memberCount?: number;
  userRole?: string;
  channelId?: string;
  streamChannelId?: string;
}

interface ChatAreaProps {
  channel: StreamChannel | null;
  metadata: ChannelMetadata | null;
}

interface ChannelData {
  id: string;
  name: string;
  stream_channel_id: string;
}

interface DMUserData {
  id: string;
  name: string;
  email: string;
}

export function ChatArea({ channel, metadata }: ChatAreaProps) {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [channelData, setChannelData] = useState<ChannelData | null>(null);
  const [dmUserData, setDmUserData] = useState<DMUserData | null>(null);
  const [isDM, setIsDM] = useState(false);
  const [memberCount, setMemberCount] = useState(0);
  const [isManagingMembers, setIsManagingMembers] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  useEffect(() => {
    if (!channel || !channel.id || !activeWorkspace?.id || !user?.id) return;

    const fetchChannelData = async () => {
      // Check if this is a DM channel
      const isDMChannel = channel.id!.startsWith('dm-');
      setIsDM(isDMChannel);

      if (isDMChannel) {
        // Get DM data from Supabase
        const { data: dmData, error: dmError } = await supabase
          .from('direct_messages')
          .select('user1_id, user2_id')
          .eq('stream_channel_id', channel.id!)
          .single();

        if (dmError || !dmData) {
          console.error('Error fetching DM data:', dmError);
          return;
        }

        // Get the other user's ID
        const otherUserId = (dmData as { user1_id: string; user2_id: string }).user1_id === user.id
          ? (dmData as { user1_id: string; user2_id: string }).user2_id
          : (dmData as { user1_id: string; user2_id: string }).user1_id;

        // Get other user's profile
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('id, full_name, email')
          .eq('id', otherUserId)
          .single();

        if (profileError || !profileData) {
          console.error('Error fetching user profile:', profileError);
          return;
        }

        setDmUserData({
          id: (profileData as { id: string }).id,
          name: (profileData as { full_name: string }).full_name || 'Unknown User',
          email: (profileData as { email: string }).email || '',
        });
        setChannelData(null);
      } else {
        // Get channel data from Supabase
        const { data, error } = await supabase
          .from('channels')
          .select('id, name, stream_channel_id')
          .eq('stream_channel_id', channel.id!)
          .single();

        if (error || !data) {
          console.error('Error fetching channel data:', error);
          return;
        }

        const channelInfo = data as ChannelData;
        setChannelData(channelInfo);
        setDmUserData(null);

        // Get member count
        const { count } = await supabase
          .from('channel_members')
          .select('*', { count: 'exact', head: true })
          .eq('channel_id', channelInfo.id);

        setMemberCount(count || 0);
      }

      // Get user role
      const { data: memberData } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', activeWorkspace.id)
        .eq('user_id', user.id)
        .single();

      if (memberData) {
        setUserRole((memberData as { role: string }).role);
      }
    };

    fetchChannelData();
  }, [channel, channel?.id, activeWorkspace?.id, user?.id]);

  if (!channel) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/20">
        <div className="text-center">
          <p className="text-muted-foreground">Select a channel or user to start messaging</p>
        </div>
      </div>
    );
  }

  // Use metadata for immediate render if available, fallback to fetched data
  const displayName = metadata?.type === 'dm'
    ? metadata.userName || dmUserData?.name || 'Direct Message'
    : metadata?.name || channelData?.name || 'Channel';

  const isDirectMessage = metadata?.type === 'dm' || isDM;
  const displayMemberCount = metadata?.memberCount ?? memberCount;
  const displayUserRole = metadata?.userRole ?? userRole;

  return (
    <>
      {/* Minimal Header - Outside Chat Container */}
      <div className="flex items-center justify-between px-6 py-4 border-b">
        <div className="flex items-center gap-2">
          {isDirectMessage ? (
            <>
              <Avatar className="size-6 rounded-md">
                <AvatarFallback className="rounded-md bg-muted text-[10px]">
                  {getInitials(displayName)}
                </AvatarFallback>
              </Avatar>
              <h1 className="text-base font-semibold">{displayName}</h1>
            </>
          ) : (
            <>
              <HashIcon className="size-4 text-muted-foreground" />
              <h1 className="text-base font-semibold">{displayName}</h1>
              {displayMemberCount > 0 && (
                <>
                  <span className="text-sm text-muted-foreground">·</span>
                  <button
                    onClick={() => displayUserRole === 'owner' && setIsManagingMembers(true)}
                    className={`flex items-center gap-1.5 text-sm text-muted-foreground transition-colors ${
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
        {displayUserRole === 'owner' && (metadata?.channelId || channelData) && !isDirectMessage && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIsManagingMembers(true)}
            className="cursor-pointer h-8"
          >
            <SettingsIcon className="size-4" />
          </Button>
        )}
      </div>

      {/* Chat Container */}
      <div className="flex-1 min-h-0">
        <Channel channel={channel}>
          <Window>
            <MessageList />
            <MessageInput />
          </Window>
          <Thread />
        </Channel>
      </div>

      {/* Manage Members Dialog */}
      {channelData && (
        <ManageChannelMembersDialog
          open={isManagingMembers}
          onOpenChange={setIsManagingMembers}
          channelId={channelData.id}
          streamChannelId={channelData.stream_channel_id}
          channelName={channelData.name}
        />
      )}
    </>
  );
}
