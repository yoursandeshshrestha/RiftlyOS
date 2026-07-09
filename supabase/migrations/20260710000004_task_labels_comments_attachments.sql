-- Task labels, comments, attachments, and activity feed (FRD §5.2)

CREATE TYPE task_activity_type AS ENUM (
  'comment',
  'attachment_added',
  'attachment_removed',
  'label_added',
  'label_removed',
  'status_changed',
  'priority_changed',
  'assignee_changed',
  'due_date_changed',
  'created'
);

-- Workspace-scoped label definitions
CREATE TABLE IF NOT EXISTS task_labels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_task_labels_workspace ON task_labels(workspace_id);

-- Many-to-many: tasks ↔ labels
CREATE TABLE IF NOT EXISTS task_label_assignments (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES task_labels(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (task_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_task_label_assignments_task ON task_label_assignments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_label_assignments_label ON task_label_assignments(label_id);

-- Task comments
CREATE TABLE IF NOT EXISTS task_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(workspace_id, task_id, created_at);

-- Task file attachments (files stored in Supabase Storage)
CREATE TABLE IF NOT EXISTS task_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_attachments_task ON task_attachments(workspace_id, task_id, created_at);

-- Unified activity feed per task
CREATE TABLE IF NOT EXISTS task_activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activity_type task_activity_type NOT NULL,
  body TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_activities_task ON task_activities(workspace_id, task_id, created_at DESC);

-- RLS
ALTER TABLE task_labels ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_label_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_activities ENABLE ROW LEVEL SECURITY;

-- Labels: workspace members can view; staff can manage
CREATE POLICY "Workspace members can view task labels"
  ON task_labels FOR SELECT TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Staff can create task labels"
  ON task_labels FOR INSERT TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee')
  );

CREATE POLICY "Staff can update task labels"
  ON task_labels FOR UPDATE TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee')
  );

CREATE POLICY "Staff can delete task labels"
  ON task_labels FOR DELETE TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) IN ('owner', 'employee')
  );

-- Label assignments: inherit task visibility
CREATE POLICY "Users can view task label assignments"
  ON task_label_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_label_assignments.task_id));

CREATE POLICY "Staff can manage task label assignments"
  ON task_label_assignments FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_label_assignments.task_id
        AND is_workspace_member(t.workspace_id, auth.uid())
        AND get_user_role_in_workspace(t.workspace_id, auth.uid()) IN ('owner', 'employee')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_label_assignments.task_id
        AND is_workspace_member(t.workspace_id, auth.uid())
        AND get_user_role_in_workspace(t.workspace_id, auth.uid()) IN ('owner', 'employee')
    )
  );

-- Comments: anyone who can see the task can read; author can insert
CREATE POLICY "Users can view task comments"
  ON task_comments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id));

CREATE POLICY "Users can create task comments"
  ON task_comments FOR INSERT TO authenticated
  WITH CHECK (
    author_id = auth.uid() AND
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_comments.task_id)
  );

CREATE POLICY "Authors can update own comments"
  ON task_comments FOR UPDATE TO authenticated
  USING (author_id = auth.uid());

CREATE POLICY "Authors and owners can delete comments"
  ON task_comments FOR DELETE TO authenticated
  USING (
    author_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_comments.task_id
        AND get_user_role_in_workspace(t.workspace_id, auth.uid()) = 'owner'
    )
  );

-- Attachments
CREATE POLICY "Users can view task attachments"
  ON task_attachments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_attachments.task_id));

CREATE POLICY "Workspace members can upload task attachments"
  ON task_attachments FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid() AND
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_attachments.task_id)
  );

CREATE POLICY "Uploaders and owners can delete attachments"
  ON task_attachments FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_attachments.task_id
        AND get_user_role_in_workspace(t.workspace_id, auth.uid()) = 'owner'
    )
  );

-- Activities (read-only for users; inserts via triggers + app)
CREATE POLICY "Users can view task activities"
  ON task_activities FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_activities.task_id));

CREATE POLICY "Users can create task activities"
  ON task_activities FOR INSERT TO authenticated
  WITH CHECK (
    actor_id = auth.uid() AND
    EXISTS (SELECT 1 FROM tasks t WHERE t.id = task_activities.task_id)
  );

-- Auto-log comment + attachment activities
CREATE OR REPLACE FUNCTION log_task_comment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO task_activities (workspace_id, task_id, actor_id, activity_type, body, metadata)
  VALUES (
    NEW.workspace_id,
    NEW.task_id,
    NEW.author_id,
    'comment',
    NEW.body,
    jsonb_build_object('comment_id', NEW.id)
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER task_comment_activity
  AFTER INSERT ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION log_task_comment_activity();

CREATE OR REPLACE FUNCTION log_task_attachment_activity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO task_activities (workspace_id, task_id, actor_id, activity_type, metadata)
    VALUES (
      NEW.workspace_id,
      NEW.task_id,
      NEW.uploaded_by,
      'attachment_added',
      jsonb_build_object(
        'attachment_id', NEW.id,
        'file_name', NEW.file_name,
        'file_size', NEW.file_size,
        'mime_type', NEW.mime_type
      )
    );
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO task_activities (workspace_id, task_id, actor_id, activity_type, metadata)
    VALUES (
      OLD.workspace_id,
      OLD.task_id,
      auth.uid(),
      'attachment_removed',
      jsonb_build_object(
        'attachment_id', OLD.id,
        'file_name', OLD.file_name
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER task_attachment_insert_activity
  AFTER INSERT ON task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION log_task_attachment_activity();

CREATE TRIGGER task_attachment_delete_activity
  AFTER DELETE ON task_attachments
  FOR EACH ROW
  EXECUTE FUNCTION log_task_attachment_activity();

DROP TRIGGER IF EXISTS set_task_comments_updated_at ON task_comments;
CREATE TRIGGER set_task_comments_updated_at
  BEFORE UPDATE ON task_comments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Storage bucket for task attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'task-attachments',
  'task-attachments',
  false,
  26214400,
  ARRAY[
    'image/jpeg', 'image/png', 'image/gif', 'image/webp',
    'application/pdf',
    'text/plain', 'text/csv',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip'
  ]
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Workspace members can read task attachments storage"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'task-attachments' AND
    is_workspace_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

CREATE POLICY "Workspace members can upload task attachments storage"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'task-attachments' AND
    is_workspace_member((storage.foldername(name))[1]::uuid, auth.uid())
  );

CREATE POLICY "Uploaders can delete own task attachment files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'task-attachments' AND
    is_workspace_member((storage.foldername(name))[1]::uuid, auth.uid())
  );
