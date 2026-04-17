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
  closed_date DATE,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS deals_workspace_id_idx ON deals(workspace_id);
CREATE INDEX IF NOT EXISTS deals_stage_idx ON deals(stage);
CREATE INDEX IF NOT EXISTS deals_created_by_idx ON deals(created_by);
CREATE INDEX IF NOT EXISTS deals_closed_date_idx ON deals(closed_date);

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

-- Create trigger to automatically set closed_date when deal moves to closed_won
CREATE OR REPLACE FUNCTION set_deal_closed_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Set closed_date when stage changes to 'closed_won' and closed_date is not already set
  IF NEW.stage = 'closed_won' AND OLD.stage != 'closed_won' AND NEW.closed_date IS NULL THEN
    NEW.closed_date = CURRENT_DATE;
  END IF;

  -- Clear closed_date if deal moves away from closed_won
  IF NEW.stage != 'closed_won' AND OLD.stage = 'closed_won' THEN
    NEW.closed_date = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_deals_closed_date ON deals;
CREATE TRIGGER set_deals_closed_date
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION set_deal_closed_date();
