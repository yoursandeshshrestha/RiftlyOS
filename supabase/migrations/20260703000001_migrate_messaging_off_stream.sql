-- Supabase-native messaging: messages + read state; remove Stream.io columns

-- ── Messages ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  direct_message_id UUID REFERENCES direct_messages(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK (char_length(trim(body)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT messages_target_check CHECK (
    (channel_id IS NOT NULL AND direct_message_id IS NULL)
    OR (channel_id IS NULL AND direct_message_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS messages_workspace_id_idx ON messages(workspace_id);
CREATE INDEX IF NOT EXISTS messages_channel_id_created_at_idx ON messages(channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_direct_message_id_created_at_idx ON messages(direct_message_id, created_at DESC);
CREATE INDEX IF NOT EXISTS messages_sender_id_idx ON messages(sender_id);

-- ── Per-user read cursor (unread counts) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_read_states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  channel_id UUID REFERENCES channels(id) ON DELETE CASCADE,
  direct_message_id UUID REFERENCES direct_messages(id) ON DELETE CASCADE,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_read_states_target_check CHECK (
    (channel_id IS NOT NULL AND direct_message_id IS NULL)
    OR (channel_id IS NULL AND direct_message_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS message_read_states_user_channel_idx
  ON message_read_states(user_id, channel_id)
  WHERE channel_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS message_read_states_user_dm_idx
  ON message_read_states(user_id, direct_message_id)
  WHERE direct_message_id IS NOT NULL;

-- ── RLS: messages ───────────────────────────────────────────────────────────

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read messages in their conversations"
  ON messages FOR SELECT
  TO authenticated
  USING (
    (
      channel_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM channel_members cm
        JOIN channels c ON c.id = cm.channel_id
        WHERE cm.channel_id = messages.channel_id
          AND cm.user_id = auth.uid()
          AND is_workspace_member(c.workspace_id, auth.uid())
      )
    )
    OR (
      direct_message_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM direct_messages dm
        WHERE dm.id = messages.direct_message_id
          AND (dm.user1_id = auth.uid() OR dm.user2_id = auth.uid())
          AND is_workspace_member(dm.workspace_id, auth.uid())
      )
    )
  );

CREATE POLICY "Users can send messages to their conversations"
  ON messages FOR INSERT
  TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND (
      (
        channel_id IS NOT NULL
        AND direct_message_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM channel_members cm
          JOIN channels c ON c.id = cm.channel_id
          WHERE cm.channel_id = messages.channel_id
            AND cm.user_id = auth.uid()
            AND is_workspace_member(c.workspace_id, auth.uid())
        )
      )
      OR (
        direct_message_id IS NOT NULL
        AND channel_id IS NULL
        AND EXISTS (
          SELECT 1
          FROM direct_messages dm
          WHERE dm.id = messages.direct_message_id
            AND (dm.user1_id = auth.uid() OR dm.user2_id = auth.uid())
            AND is_workspace_member(dm.workspace_id, auth.uid())
        )
      )
    )
  );

-- ── RLS: message_read_states ────────────────────────────────────────────────

ALTER TABLE message_read_states ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own read state"
  ON message_read_states FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ── Realtime ────────────────────────────────────────────────────────────────

ALTER TABLE messages REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ── DM helper (no Stream IDs) ─────────────────────────────────────────────────

ALTER TABLE direct_messages ALTER COLUMN stream_channel_id DROP NOT NULL;
ALTER TABLE channels ALTER COLUMN stream_channel_id DROP NOT NULL;

CREATE OR REPLACE FUNCTION get_or_create_dm_channel(
  p_workspace_id UUID,
  p_user1_id UUID,
  p_user2_id UUID
)
RETURNS TABLE (
  id UUID,
  user1_id UUID,
  user2_id UUID
) AS $$
DECLARE
  v_ordered_user1_id UUID;
  v_ordered_user2_id UUID;
  v_dm_id UUID;
BEGIN
  IF p_user1_id < p_user2_id THEN
    v_ordered_user1_id := p_user1_id;
    v_ordered_user2_id := p_user2_id;
  ELSE
    v_ordered_user1_id := p_user2_id;
    v_ordered_user2_id := p_user1_id;
  END IF;

  SELECT dm.id INTO v_dm_id
  FROM direct_messages dm
  WHERE dm.workspace_id = p_workspace_id
    AND dm.user1_id = v_ordered_user1_id
    AND dm.user2_id = v_ordered_user2_id;

  IF v_dm_id IS NULL THEN
    INSERT INTO direct_messages (workspace_id, user1_id, user2_id)
    VALUES (p_workspace_id, v_ordered_user1_id, v_ordered_user2_id)
    RETURNING direct_messages.id INTO v_dm_id;
  END IF;

  RETURN QUERY
  SELECT dm.id, dm.user1_id, dm.user2_id
  FROM direct_messages dm
  WHERE dm.id = v_dm_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ── Default channel trigger (no Stream IDs) ───────────────────────────────────

CREATE OR REPLACE FUNCTION create_default_channel()
RETURNS TRIGGER AS $$
DECLARE
  new_channel_id UUID;
BEGIN
  INSERT INTO channels (workspace_id, name, is_default, created_by)
  VALUES (NEW.id, 'general', true, NEW.created_by)
  RETURNING id INTO new_channel_id;

  INSERT INTO channel_members (channel_id, user_id)
  VALUES (new_channel_id, NEW.created_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop Stream columns (routing uses channel UUID + dm-{userId} hash)
ALTER TABLE channels DROP COLUMN IF EXISTS stream_channel_id;
ALTER TABLE direct_messages DROP COLUMN IF EXISTS stream_channel_id;

DROP INDEX IF EXISTS channels_stream_channel_id_idx;
DROP INDEX IF EXISTS direct_messages_stream_channel_id_idx;

DROP TRIGGER IF EXISTS set_message_read_states_updated_at ON message_read_states;
CREATE TRIGGER set_message_read_states_updated_at
  BEFORE UPDATE ON message_read_states
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
