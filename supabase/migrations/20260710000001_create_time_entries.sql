-- Time tracking on tasks (FRD §5.2 / Plan 03)
-- Asana-style: start/stop timer + manual entries, billable flag, multiple entries per task per user.

CREATE TYPE time_entry_source AS ENUM ('timer', 'manual');

CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- NULL minutes + non-null started_at = a running timer
  minutes INTEGER,
  billable BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  source time_entry_source NOT NULL,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_entries_workspace_task ON time_entries(workspace_id, task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_workspace_user ON time_entries(workspace_id, user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON time_entries(task_id);

-- One running timer per user at a time (Asana-style global timer)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_running_timer_per_user
  ON time_entries(user_id)
  WHERE minutes IS NULL;

ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;

-- Clients have ZERO access to time/cost data (PRD §5.9)
CREATE POLICY "Staff can view time entries in workspace"
  ON time_entries FOR SELECT
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee')
  );

CREATE POLICY "Staff can insert own time entries"
  ON time_entries FOR INSERT
  TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee') AND
    user_id = auth.uid()
  );

CREATE POLICY "Staff can update own time entries"
  ON time_entries FOR UPDATE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee') AND
    user_id = auth.uid()
  )
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee') AND
    user_id = auth.uid()
  );

CREATE POLICY "Staff can delete own time entries"
  ON time_entries FOR DELETE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee') AND
    user_id = auth.uid()
  );
