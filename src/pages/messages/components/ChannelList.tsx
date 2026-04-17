import { useEffect, useState } from 'react';
import { useStream } from '../../../contexts/StreamContext';
import { useWorkspace } from '../../../contexts/WorkspaceContext';
import { supabase } from '../../../lib/supabase';
import { HashIcon, PlusIcon, LoaderIcon } from '@/components/icons';
import type { Channel } from 'stream-chat';

interface ChannelData {
  id: string;
  name: string;
  stream_channel_id: string;
  is_default: boolean;
}

interface ChannelListProps {
  onChannelSelect: (channel: Channel) => void;
  selectedChannelId?: string;
}

export function ChannelList({ onChannelSelect, selectedChannelId }: ChannelListProps) {
  const { client, isConnected } = useStream();
  const { activeWorkspace } = useWorkspace();
  const [channels, setChannels] = useState<ChannelData[]>([]);
  const [streamChannels, setStreamChannels] = useState<Map<string, Channel>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeWorkspace || !isConnected || !client) return;

    async function loadChannels() {
      try {
        // Fetch channel metadata from Supabase
        const { data, error } = await supabase
          .from('channels')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .order('is_default', { ascending: false })
          .order('created_at', { ascending: true });

        if (error) throw error;

        setChannels(data || []);

        // Query Stream.io channels
        if (data && data.length > 0) {
          const channelIds = data.map((ch) => ch.stream_channel_id);
          const filter = { id: { $in: channelIds } };
          const sort = [{ last_message_at: -1 as const }];

          const streamChannelsResponse = await client!.queryChannels(filter, sort);
          const channelMap = new Map(
            streamChannelsResponse.map((ch) => [ch.id!, ch])
          );
          setStreamChannels(channelMap);
        }
      } catch (error) {
        console.error('Failed to load channels:', error);
      } finally {
        setLoading(false);
      }
    }

    loadChannels();
  }, [activeWorkspace?.id, isConnected, client]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <LoaderIcon className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Channels</h2>
          <button
            className="p-1 hover:bg-accent rounded cursor-pointer"
            title="Create channel"
          >
            <PlusIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {channels.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground text-center">
            No channels yet
          </div>
        ) : (
          <div className="py-2">
            {channels.map((channel) => {
              const streamChannel = streamChannels.get(channel.stream_channel_id);
              const isSelected = selectedChannelId === channel.stream_channel_id;

              return (
                <button
                  key={channel.id}
                  onClick={() => streamChannel && onChannelSelect(streamChannel)}
                  className={`w-full px-4 py-2 flex items-center gap-2 hover:bg-accent cursor-pointer ${
                    isSelected ? 'bg-accent' : ''
                  }`}
                >
                  <HashIcon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{channel.name}</span>
                  {channel.is_default && (
                    <span className="ml-auto text-xs text-muted-foreground">default</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
