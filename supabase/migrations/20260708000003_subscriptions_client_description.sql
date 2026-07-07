-- Link retainers to clients and store a display label

ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_client
  ON subscriptions(workspace_id, client_user_id);
