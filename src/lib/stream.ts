import { StreamChat } from 'stream-chat';
import type { StreamChat as StreamChatType } from 'stream-chat';
import { supabase } from './supabase';

const apiKey = import.meta.env.VITE_STREAM_API_KEY;

if (!apiKey) {
  throw new Error('Missing VITE_STREAM_API_KEY environment variable');
}

let chatClient: StreamChatType | null = null;

export function getStreamClient(): StreamChatType {
  if (!chatClient) {
    chatClient = StreamChat.getInstance(apiKey);
  }
  return chatClient;
}

interface StreamTokenResponse {
  token: string;
  userId: string;
  userName: string;
  avatarUrl?: string;
}

export async function getStreamToken(): Promise<StreamTokenResponse> {
  try {
    // Get current session
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      throw new Error('No active session');
    }

    console.log('Calling Edge Function with session:', session.user.id);

    // Invoke the function
    const { data, error } = await supabase.functions.invoke('generate-stream-token', {
      body: {},
    });

    if (error) {
      console.error('Edge Function error:', error);
      throw error;
    }

    if (!data) {
      throw new Error('No data returned from Edge Function');
    }

    console.log('Stream token received:', data);
    return data as StreamTokenResponse;
  } catch (error) {
    console.error('Failed to get Stream token:', error);
    throw new Error(`Failed to generate Stream token: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

export async function connectStreamUser(userId: string, userName: string, token: string, avatarUrl?: string) {
  const client = getStreamClient();

  await client.connectUser(
    {
      id: userId,
      name: userName,
      image: avatarUrl,
    },
    token
  );

  return client;
}

export async function disconnectStreamUser() {
  const client = getStreamClient();

  if (client.userID) {
    await client.disconnectUser();
  }

  chatClient = null;
}

export async function createChannel(
  workspaceId: string,
  channelName: string,
  channelDescription: string,
  memberIds: string[]
) {
  const client = getStreamClient();
  const streamChannelId = `${workspaceId}-${channelName.toLowerCase().replace(/\s+/g, '-')}`;

  const channel = client.channel('messaging', streamChannelId, {
    name: channelName,
    description: channelDescription,
    members: memberIds,
  } as any);

  await channel.create();

  return {
    streamChannelId,
    channel,
  };
}

export async function addMembersToChannel(channelId: string, memberIds: string[]) {
  const client = getStreamClient();
  const channel = client.channel('messaging', channelId);

  await channel.addMembers(memberIds);
}

export async function removeMembersFromChannel(channelId: string, memberIds: string[]) {
  const client = getStreamClient();
  const channel = client.channel('messaging', channelId);

  await channel.removeMembers(memberIds);
}
