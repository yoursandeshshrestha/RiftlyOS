-- Email queue for async Resend delivery (processed by send-email Edge Function)

CREATE TYPE email_delivery_status AS ENUM ('pending', 'sent', 'failed');

CREATE TABLE IF NOT EXISTS email_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  template TEXT NOT NULL,
  recipient TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status email_delivery_status NOT NULL DEFAULT 'pending',
  subject TEXT,
  resend_id TEXT,
  error_message TEXT,
  created_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS email_queue_workspace_id_idx ON email_queue(workspace_id);
CREATE INDEX IF NOT EXISTS email_queue_status_idx ON email_queue(status);
CREATE INDEX IF NOT EXISTS email_queue_created_at_idx ON email_queue(created_at DESC);
CREATE INDEX IF NOT EXISTS email_queue_template_idx ON email_queue(template);

ALTER TABLE email_queue ENABLE ROW LEVEL SECURITY;

-- Staff can view email history for their workspace (audit / debugging)
CREATE POLICY "Staff can view workspace email queue"
  ON email_queue FOR SELECT
  TO authenticated
  USING (
    workspace_id IS NOT NULL
    AND is_workspace_member(workspace_id, auth.uid())
    AND get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee')
  );

-- Inserts/updates only via service role (Edge Function)
CREATE POLICY "Service role manages email queue"
  ON email_queue FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS set_email_queue_updated_at ON email_queue;
CREATE TRIGGER set_email_queue_updated_at
  BEFORE UPDATE ON email_queue
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
