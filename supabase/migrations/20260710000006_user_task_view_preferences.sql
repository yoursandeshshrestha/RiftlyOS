-- Per-user task view settings (filters + table display properties) per workspace
CREATE TABLE IF NOT EXISTS user_task_view_preferences (
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  settings JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_user_task_view_preferences_workspace
  ON user_task_view_preferences(workspace_id);

ALTER TABLE user_task_view_preferences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own task view preferences"
  ON user_task_view_preferences FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
