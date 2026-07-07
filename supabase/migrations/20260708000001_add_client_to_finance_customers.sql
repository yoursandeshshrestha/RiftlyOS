-- Support multiple billable clients per workspace

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES profiles(id) ON DELETE CASCADE;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS client_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

DROP INDEX IF EXISTS uniq_customer_workspace;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_customer_workspace_client
  ON customers(workspace_id, client_user_id);

CREATE INDEX IF NOT EXISTS idx_customers_workspace_client
  ON customers(workspace_id, client_user_id);

CREATE INDEX IF NOT EXISTS idx_invoices_workspace_client
  ON invoices(workspace_id, client_user_id);
