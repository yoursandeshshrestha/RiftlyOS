-- Retry tracking + owner-only read access for email deliveries admin page

ALTER TABLE email_queue
  ADD COLUMN IF NOT EXISTS retry_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_retry_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS email_queue_retry_count_idx ON email_queue(retry_count);

DROP POLICY IF EXISTS "Staff can view workspace email queue" ON email_queue;

CREATE POLICY "Owners can view workspace email queue"
  ON email_queue FOR SELECT
  TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND is_workspace_member(workspace_id, auth.uid())
    AND get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
  );
