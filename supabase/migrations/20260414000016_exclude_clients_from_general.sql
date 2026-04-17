-- Remove existing clients from default/general channels
DELETE FROM channel_members
WHERE user_id IN (
  SELECT wm.user_id
  FROM workspace_members wm
  WHERE wm.role = 'client'
)
AND channel_id IN (
  SELECT id FROM channels WHERE is_default = true
);

-- Update function to exclude clients from being auto-added to default channel
CREATE OR REPLACE FUNCTION add_member_to_default_channel()
RETURNS TRIGGER AS $$
DECLARE
  default_channel_id UUID;
BEGIN
  -- Only add owners and employees to default channel, exclude clients
  IF NEW.role = 'client' THEN
    RETURN NEW;
  END IF;

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
