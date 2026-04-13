-- Create deal stage enum
CREATE TYPE deal_stage AS ENUM ('lead', 'proposal_sent', 'negotiation', 'closed_won', 'closed_lost');

-- Create deals table
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  prospect_name TEXT NOT NULL,
  services TEXT NOT NULL,
  deal_value DECIMAL(10, 2) NOT NULL DEFAULT 0,
  stage deal_stage NOT NULL DEFAULT 'lead',
  next_action TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS deals_workspace_id_idx ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals(stage);
CREATE INDEX IF NOT EXISTS deals_created_by_idx ON deals(created_by);

-- Enable Row Level Security
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;

-- RLS Policies for deals
CREATE POLICY "Users can view deals in their workspace"
  ON deals FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can create deals"
  ON deals FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can update deals"
  ON deals FOR UPDATE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can delete deals"
  ON deals FOR DELETE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

-- Create trigger for deals updated_at
DROP TRIGGER IF EXISTS set_deals_updated_at ON deals;
CREATE TRIGGER set_deals_updated_at
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
