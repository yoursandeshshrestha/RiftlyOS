-- Create channels table
CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  stream_channel_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create channel_members table
CREATE TABLE IF NOT EXISTS channel_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(channel_id, user_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS channels_workspace_id_idx ON channels(workspace_id);
CREATE INDEX IF NOT EXISTS channels_stream_channel_id_idx ON channels(stream_channel_id);
CREATE INDEX IF NOT EXISTS channel_members_channel_id_idx ON channel_members(channel_id);
CREATE INDEX IF NOT EXISTS channel_members_user_id_idx ON channel_members(user_id);

-- Enable Row Level Security
ALTER TABLE channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies for channels
CREATE POLICY "Users can view channels in their workspace"
  ON channels FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can create channels"
  ON channels FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can update channels"
  ON channels FOR UPDATE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can delete channels"
  ON channels FOR DELETE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

-- RLS Policies for channel_members
CREATE POLICY "Users can view members of channels they have access to"
  ON channel_members FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = channel_members.channel_id
      AND is_workspace_member(channels.workspace_id, auth.uid())
    )
  );

CREATE POLICY "Workspace owners can add channel members"
  ON channel_members FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = channel_members.channel_id
      AND is_workspace_admin(channels.workspace_id, auth.uid())
    )
  );

CREATE POLICY "Workspace owners can remove channel members"
  ON channel_members FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM channels
      WHERE channels.id = channel_members.channel_id
      AND is_workspace_admin(channels.workspace_id, auth.uid())
    )
  );

-- Create trigger for channels updated_at
DROP TRIGGER IF EXISTS set_channels_updated_at ON channels;
CREATE TRIGGER set_channels_updated_at
  BEFORE UPDATE ON channels
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to create default "general" channel when workspace is created
CREATE OR REPLACE FUNCTION create_default_channel()
RETURNS TRIGGER AS $$
DECLARE
  new_channel_id UUID;
  stream_channel_id TEXT;
BEGIN
  -- Generate Stream.io channel ID (workspace_id + '-general')
  stream_channel_id := NEW.id::text || '-general';

  -- Create default general channel
  INSERT INTO channels (workspace_id, stream_channel_id, name, is_default, created_by)
  VALUES (NEW.id, stream_channel_id, 'general', true, NEW.created_by)
  RETURNING id INTO new_channel_id;

  -- Add creator to the channel
  INSERT INTO channel_members (channel_id, user_id)
  VALUES (new_channel_id, NEW.created_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS create_workspace_default_channel ON workspaces;
CREATE TRIGGER create_workspace_default_channel
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION create_default_channel();

-- Function to auto-add new workspace members to default channel
CREATE OR REPLACE FUNCTION add_member_to_default_channel()
RETURNS TRIGGER AS $$
DECLARE
  default_channel_id UUID;
BEGIN
  -- Get the default channel for this workspace
  SELECT id INTO default_channel_id
  FROM channels
  WHERE workspace_id = NEW.workspace_id
  AND is_default = true
  LIMIT 1;

  -- Add member to default channel if it exists
  IF default_channel_id IS NOT NULL THEN
    INSERT INTO channel_members (channel_id, user_id)
    VALUES (default_channel_id, NEW.user_id)
    ON CONFLICT (channel_id, user_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS add_workspace_member_to_default_channel ON workspace_members;
CREATE TRIGGER add_workspace_member_to_default_channel
  AFTER INSERT ON workspace_members
  FOR EACH ROW
  EXECUTE FUNCTION add_member_to_default_channel();
