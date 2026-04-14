-- Create revenue entry category enum
CREATE TYPE revenue_category AS ENUM ('service_income', 'project_income', 'other');

-- Create revenue_targets table
CREATE TABLE IF NOT EXISTS revenue_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- First day of the month (e.g., 2026-04-01)
  target_amount DECIMAL(10, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(workspace_id, month)
);

-- Create revenue_entries table (for manual revenue tracking)
CREATE TABLE IF NOT EXISTS revenue_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  description TEXT NOT NULL,
  entry_date DATE NOT NULL,
  category revenue_category NOT NULL DEFAULT 'other',
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create indexes for revenue_targets
CREATE INDEX IF NOT EXISTS revenue_targets_workspace_id_idx ON revenue_targets(workspace_id);
CREATE INDEX IF NOT EXISTS revenue_targets_month_idx ON revenue_targets(month);

-- Create indexes for revenue_entries
CREATE INDEX IF NOT EXISTS revenue_entries_workspace_id_idx ON revenue_entries(workspace_id);
CREATE INDEX IF NOT EXISTS revenue_entries_entry_date_idx ON revenue_entries(entry_date);
CREATE INDEX IF NOT EXISTS revenue_entries_category_idx ON revenue_entries(category);
CREATE INDEX IF NOT EXISTS revenue_entries_created_by_idx ON revenue_entries(created_by);

-- Enable Row Level Security
ALTER TABLE revenue_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_entries ENABLE ROW LEVEL SECURITY;

-- RLS Policies for revenue_targets (all workspace members except clients can view, only owners can modify)
CREATE POLICY "Non-client members can view revenue targets"
  ON revenue_targets FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = revenue_targets.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role != 'client'
    )
  );

CREATE POLICY "Workspace owners can create revenue targets"
  ON revenue_targets FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can update revenue targets"
  ON revenue_targets FOR UPDATE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can delete revenue targets"
  ON revenue_targets FOR DELETE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

-- RLS Policies for revenue_entries (non-client members can view, employees and owners can create/update/delete)
CREATE POLICY "Non-client members can view revenue entries"
  ON revenue_entries FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = revenue_entries.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role != 'client'
    )
  );

CREATE POLICY "Non-client members can create revenue entries"
  ON revenue_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = revenue_entries.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role != 'client'
    )
  );

CREATE POLICY "Non-client members can update revenue entries"
  ON revenue_entries FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = revenue_entries.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role != 'client'
    )
  );

CREATE POLICY "Non-client members can delete revenue entries"
  ON revenue_entries FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM workspace_members
      WHERE workspace_members.workspace_id = revenue_entries.workspace_id
        AND workspace_members.user_id = auth.uid()
        AND workspace_members.role != 'client'
    )
  );

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS set_revenue_targets_updated_at ON revenue_targets;
CREATE TRIGGER set_revenue_targets_updated_at
  BEFORE UPDATE ON revenue_targets
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_revenue_entries_updated_at ON revenue_entries;
CREATE TRIGGER set_revenue_entries_updated_at
  BEFORE UPDATE ON revenue_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();
