import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Chat } from 'stream-chat-react';
import { useStream } from '../../contexts/StreamContext';
import { useAuth } from '../../contexts/AuthContext';
import { ChatArea } from './components/ChatArea';
import { ChatSkeleton } from './components/ChatSkeleton';
import type { Channel } from 'stream-chat';
import { LoaderIcon } from '@/components/icons';
import { supabase } from '../../lib/supabase';

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

export default function Messages() {
  const { client, isConnecting, isConnected, error } = useStream();
  const { user } = useAuth();
  const [selectedChannel, setSelectedChannel] = useState<Channel | null>(null);
  const [channelMetadata, setChannelMetadata] = useState<ChannelMetadata | null>(null);
  const [channelError, setChannelError] = useState<string | null>(null);
  const [isLoadingChannel, setIsLoadingChannel] = useState(false);
  const [isDark, setIsDark] = useState(false);
  const location = useLocation();

  // Detect dark mode
  useEffect(() => {
    const checkDarkMode = () => {
      const isDarkMode = document.documentElement.classList.contains('dark');
      setIsDark(isDarkMode);
      console.log('Dark mode:', isDarkMode);
    };

    checkDarkMode();

    // Watch for theme changes
    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => observer.disconnect();
  }, []);

  // Auto-select channel from URL hash
  useEffect(() => {
    if (!client || !isConnected || !user?.id) return;

    async function loadChannel() {
      const hashValue = location.hash.replace('#', '');
      console.log('Loading channel/DM:', hashValue);

      if (!hashValue) {
        console.log('No channel/DM ID in URL hash');
        setSelectedChannel(null);
        setIsLoadingChannel(false);
        return;
      }

      try {
        setIsLoadingChannel(true);
        setChannelError(null);

        // Check if this is a DM (starts with 'dm-')
        if (hashValue.startsWith('dm-')) {
          const otherUserId = hashValue.replace('dm-', '');
          console.log('Loading DM with user:', otherUserId);

          if (!user?.id) {
            setChannelError('User not authenticated');
            return;
          }

          // Get the active workspace
          const { data: workspaceData } = await supabase
            .from('workspace_members')
            .select('workspace_id')
            .eq('user_id', user.id)
            .limit(1)
            .single();

          if (!workspaceData) {
            setChannelError('No workspace found');
            return;
          }

          const workspaceId = (workspaceData as { workspace_id: string }).workspace_id;

          // Get or create DM channel
          const { data: dmData, error: dmError } = await supabase
            .rpc('get_or_create_dm_channel', {
              p_workspace_id: workspaceId,
              p_user1_id: user.id,
              p_user2_id: otherUserId,
            });

          if (dmError || !dmData || dmData.length === 0) {
            console.error('Failed to get/create DM:', dmError);
            setChannelError('Failed to load direct message');
            return;
          }

          const dm = dmData[0];
          const streamChannelId = dm.stream_channel_id;

          // Check if already on this channel
          if (selectedChannel && selectedChannel.id === streamChannelId) {
            console.log('DM channel already selected');
            return;
          }

          // Fetch the other user's profile to upsert in Stream.io
          const { data: otherUserProfile, error: profileError } = await supabase
            .from('profiles')
            .select('id, full_name, avatar_url')
            .eq('id', otherUserId)
            .single();

          if (profileError || !otherUserProfile) {
            console.error('Failed to fetch other user profile:', profileError);
            setChannelError('User not found');
            return;
          }

          // Upsert the other user in Stream.io (in case they haven't connected yet)
          try {
            await client!.upsertUsers([
              {
                id: otherUserId,
                name: (otherUserProfile as { full_name: string }).full_name || 'Unknown User',
                image: (otherUserProfile as { avatar_url?: string }).avatar_url,
              }
            ]);
            console.log('Other user upserted in Stream.io');
          } catch (upsertError) {
            console.error('Failed to upsert user:', upsertError);
            // Continue anyway, the channel creation might still work
          }

          // Create Stream.io channel with both users
          const channel = client!.channel('messaging', streamChannelId, {
            members: [user!.id, otherUserId],
          });

          console.log('Watching DM channel...');
          await channel.watch();
          console.log('DM channel loaded successfully');

          // Set metadata for immediate header render
          setChannelMetadata({
            type: 'dm',
            userName: (otherUserProfile as { full_name: string }).full_name || 'Unknown User',
            userAvatar: (otherUserProfile as { avatar_url?: string }).avatar_url,
          });

          setSelectedChannel(channel);
          setIsLoadingChannel(false);

        } else {
          // Regular channel
          const channelId = hashValue;

          if (selectedChannel && selectedChannel.id === channelId) {
            console.log('Channel already selected');
            return;
          }

          // Check if user is a member of this channel
          console.log('Fetching channel from Supabase:', channelId);
          const { data: channelData, error: channelErr } = await supabase
            .from('channels')
            .select('id, name, workspace_id, stream_channel_id')
            .eq('stream_channel_id', channelId)
            .single();

          if (channelErr || !channelData) {
            console.error('Channel not found in Supabase:', channelErr);
            setChannelError('Channel not found');
            return;
          }

          const dbChannelId = (channelData as { id: string; workspace_id: string; stream_channel_id: string }).id;
          const workspaceId = (channelData as { id: string; workspace_id: string; stream_channel_id: string }).workspace_id;

          // Check if current user is a member
          const { data: membership } = await supabase
            .from('channel_members')
            .select('id')
            .eq('channel_id', dbChannelId)
            .eq('user_id', user!.id)
            .single();

          if (!membership) {
            console.error('User is not a member of this channel');
            setChannelError('You do not have access to this channel');
            return;
          }

          // Fetch member count and user role in parallel
          const [memberCountResult, userRoleResult] = await Promise.all([
            supabase
              .from('channel_members')
              .select('*', { count: 'exact', head: true })
              .eq('channel_id', dbChannelId),
            supabase
              .from('workspace_members')
              .select('role')
              .eq('workspace_id', workspaceId)
              .eq('user_id', user!.id)
              .single()
          ]);

          if (!client) {
            setChannelError('Client not available');
            return;
          }

          // Get channel without modifying members
          const channel = client.channel('messaging', channelId);

          console.log('Watching channel...');
          await channel.watch();
          console.log('Channel loaded successfully');

          // Set metadata for immediate header render
          setChannelMetadata({
            type: 'channel',
            name: (channelData as { name: string }).name,
            memberCount: memberCountResult.count || 0,
            userRole: userRoleResult.data ? (userRoleResult.data as { role: string }).role : undefined,
            channelId: dbChannelId,
            streamChannelId: (channelData as { stream_channel_id: string }).stream_channel_id,
          });

          setSelectedChannel(channel);
          setIsLoadingChannel(false);
        }
      } catch (err) {
        console.error('Failed to load channel:', err);
        setChannelError(err instanceof Error ? err.message : 'Failed to load channel');
        setIsLoadingChannel(false);
      }
    }

    loadChannel();
  }, [location.hash, client, isConnected, user?.id]);

  // Listen for real-time channel membership changes
  useEffect(() => {
    if (!user?.id || !selectedChannel) return;

    const channelSubscription = supabase
      .channel('user-channel-membership')
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'channel_members',
          filter: `user_id=eq.${user.id}`
        },
        async (payload) => {
          console.log('Removed from channel:', payload);

          // Check if removed from current channel
          const { data: channelData } = await supabase
            .from('channels')
            .select('stream_channel_id')
            .eq('id', payload.old.channel_id)
            .single();

          if (channelData && (channelData as any).stream_channel_id === selectedChannel.id) {
            setSelectedChannel(null);
            setChannelError('You have been removed from this channel');
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelSubscription);
    };
  }, [user?.id, selectedChannel]);

  if (isConnecting) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <LoaderIcon className="w-8 h-8 animate-spin text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Connecting to chat...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <p className="text-destructive mb-2">Failed to connect to chat</p>
          <p className="text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  if (!isConnected || !client) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Chat not available</p>
      </div>
    );
  }

  const chatTheme = isDark ? 'str-chat__theme-dark' : 'str-chat__theme-light';
  console.log('Using chat theme:', chatTheme);

  return (
    <div className="h-full flex flex-col">
      {isLoadingChannel ? (
        <ChatSkeleton />
      ) : (
        <Chat client={client} theme={chatTheme}>
          {channelError ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-destructive mb-2">Error loading channel</p>
                <p className="text-sm text-muted-foreground">{channelError}</p>
              </div>
            </div>
          ) : (
            <ChatArea channel={selectedChannel} metadata={channelMetadata} />
          )}
        </Chat>
      )}
    </div>
  );
}
