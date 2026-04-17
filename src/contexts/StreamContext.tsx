import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { StreamChat as StreamChatType } from 'stream-chat';
import { useAuth } from './AuthContext';
import { getStreamToken, connectStreamUser, disconnectStreamUser } from '../lib/stream';

interface StreamContextValue {
  client: StreamChatType | null;
  isConnecting: boolean;
  isConnected: boolean;
  error: string | null;
}

const StreamContext = createContext<StreamContextValue | undefined>(undefined);

interface StreamProviderProps {
  children: ReactNode;
}

export function StreamProvider({ children }: StreamProviderProps) {
  const { user } = useAuth();
  const [client, setClient] = useState<StreamChatType | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function initStreamClient() {
      if (!user) {
        // Disconnect if user logs out
        if (client) {
          await disconnectStreamUser();
          setClient(null);
          setIsConnected(false);
        }
        return;
      }

      // Don't reconnect if already connected
      if (client?.userID === user.id) {
        return;
      }

      setIsConnecting(true);
      setError(null);

      try {
        // Get Stream token from backend
        const { token, userId, userName, avatarUrl } = await getStreamToken();

        if (!isMounted) return;

        // Connect user to Stream
        const streamClient = await connectStreamUser(userId, userName, token, avatarUrl);

        if (!isMounted) return;

        setClient(streamClient);
        setIsConnected(true);
      } catch (err) {
        console.error('Failed to connect to Stream:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to connect to chat');
        }
      } finally {
        if (isMounted) {
          setIsConnecting(false);
        }
      }
    }

    initStreamClient();

    return () => {
      isMounted = false;
    };
  }, [user?.id]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (client) {
        disconnectStreamUser().catch(console.error);
      }
    };
  }, []);

  const value: StreamContextValue = {
    client,
    isConnecting,
    isConnected,
    error,
  };

  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export function useStream() {
  const context = useContext(StreamContext);
  if (context === undefined) {
    throw new Error('useStream must be used within a StreamProvider');
  }
  return context;
}
