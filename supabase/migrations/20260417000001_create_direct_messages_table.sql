-- Create direct_messages table to track DM channels
CREATE TABLE IF NOT EXISTS direct_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stream_channel_id TEXT UNIQUE NOT NULL,
  user1_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  user2_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- Ensure user1_id is always less than user2_id for consistency
  CONSTRAINT user_order CHECK (user1_id < user2_id),
  -- Ensure unique DM between two users in a workspace
  UNIQUE(workspace_id, user1_id, user2_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS direct_messages_workspace_id_idx ON direct_messages(workspace_id);
CREATE INDEX IF NOT EXISTS direct_messages_stream_channel_id_idx ON direct_messages(stream_channel_id);
CREATE INDEX IF NOT EXISTS direct_messages_user1_id_idx ON direct_messages(user1_id);
CREATE INDEX IF NOT EXISTS direct_messages_user2_id_idx ON direct_messages(user2_id);

-- Enable Row Level Security
ALTER TABLE direct_messages ENABLE ROW LEVEL SECURITY;

-- RLS Policies for direct_messages
CREATE POLICY "Users can view their own DMs"
  ON direct_messages FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user1_id OR auth.uid() = user2_id
  );

CREATE POLICY "Users can create DMs"
  ON direct_messages FOR INSERT
  TO authenticated
  WITH CHECK (
    (auth.uid() = user1_id OR auth.uid() = user2_id)
    AND is_workspace_member(workspace_id, auth.uid())
    AND is_workspace_member(workspace_id, user1_id)
    AND is_workspace_member(workspace_id, user2_id)
  );

-- Create trigger for direct_messages updated_at
DROP TRIGGER IF EXISTS set_direct_messages_updated_at ON direct_messages;
CREATE TRIGGER set_direct_messages_updated_at
  BEFORE UPDATE ON direct_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to get or create a DM channel between two users
CREATE OR REPLACE FUNCTION get_or_create_dm_channel(
  p_workspace_id UUID,
  p_user1_id UUID,
  p_user2_id UUID
)
RETURNS TABLE (
  id UUID,
  stream_channel_id TEXT,
  user1_id UUID,
  user2_id UUID
) AS $$
DECLARE
  v_ordered_user1_id UUID;
  v_ordered_user2_id UUID;
  v_stream_channel_id TEXT;
  v_dm_id UUID;
BEGIN
  -- Order user IDs to ensure consistency
  IF p_user1_id < p_user2_id THEN
    v_ordered_user1_id := p_user1_id;
    v_ordered_user2_id := p_user2_id;
  ELSE
    v_ordered_user1_id := p_user2_id;
    v_ordered_user2_id := p_user1_id;
  END IF;

  -- Check if DM already exists
  SELECT dm.id, dm.stream_channel_id
  INTO v_dm_id, v_stream_channel_id
  FROM direct_messages dm
  WHERE dm.workspace_id = p_workspace_id
    AND dm.user1_id = v_ordered_user1_id
    AND dm.user2_id = v_ordered_user2_id;

  -- If not found, create new DM
  IF v_dm_id IS NULL THEN
    -- Generate Stream.io channel ID using MD5 hash to stay under 64 char limit
    -- Format: dm-{md5_hash} = 3 + 32 = 35 characters (well under 64 limit)
    v_stream_channel_id := 'dm-' || md5(v_ordered_user1_id::text || '-' || v_ordered_user2_id::text);

    -- Insert new DM
    INSERT INTO direct_messages (workspace_id, stream_channel_id, user1_id, user2_id)
    VALUES (p_workspace_id, v_stream_channel_id, v_ordered_user1_id, v_ordered_user2_id)
    RETURNING direct_messages.id INTO v_dm_id;
  END IF;

  -- Return the DM info
  RETURN QUERY
  SELECT dm.id, dm.stream_channel_id, dm.user1_id, dm.user2_id
  FROM direct_messages dm
  WHERE dm.id = v_dm_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
