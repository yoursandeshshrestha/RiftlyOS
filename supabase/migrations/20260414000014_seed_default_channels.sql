-- Create "general" channels for existing workspaces that don't have one
DO $$
DECLARE
  workspace_record RECORD;
  new_channel_id UUID;
  stream_channel_id TEXT;
BEGIN
  -- Loop through all workspaces
  FOR workspace_record IN
    SELECT w.id, w.created_by
    FROM workspaces w
    WHERE NOT EXISTS (
      SELECT 1 FROM channels c
      WHERE c.workspace_id = w.id AND c.is_default = true
    )
  LOOP
    -- Generate Stream.io channel ID
    stream_channel_id := workspace_record.id::text || '-general';

    -- Create default general channel
    INSERT INTO channels (workspace_id, stream_channel_id, name, is_default, created_by)
    VALUES (workspace_record.id, stream_channel_id, 'general', true, workspace_record.created_by)
    RETURNING id INTO new_channel_id;

    -- Add all workspace members to the general channel
    INSERT INTO channel_members (channel_id, user_id)
    SELECT new_channel_id, wm.user_id
    FROM workspace_members wm
    WHERE wm.workspace_id = workspace_record.id;

    RAISE NOTICE 'Created general channel for workspace %', workspace_record.id;
  END LOOP;
END $$;
