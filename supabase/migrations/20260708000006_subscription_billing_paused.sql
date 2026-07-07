-- Track Stripe pause_collection separately from subscription status
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS billing_paused BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_subscriptions_workspace_billing_paused
  ON subscriptions(workspace_id, billing_paused)
  WHERE billing_paused = true;
