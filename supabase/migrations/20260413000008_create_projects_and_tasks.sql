-- Create project status enum
CREATE TYPE project_status AS ENUM ('active', 'paused', 'completed');

-- Create task priority enum
CREATE TYPE task_priority AS ENUM ('high', 'medium', 'low');

-- Create projects table
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status project_status NOT NULL DEFAULT 'active',
  flags TEXT, -- Multi-line text for bullet points
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create project_members junction table for client and employee assignments
CREATE TABLE IF NOT EXISTS project_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  member_type TEXT NOT NULL CHECK (member_type IN ('client', 'employee')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

-- Create services table
CREATE TABLE IF NOT EXISTS services (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mrr DECIMAL(10, 2) NOT NULL DEFAULT 0,
  start_date DATE NOT NULL,
  renewal_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create task_columns table
CREATE TABLE IF NOT EXISTS task_columns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  column_id UUID NOT NULL REFERENCES task_columns(id) ON DELETE CASCADE,
  priority task_priority NOT NULL DEFAULT 'medium',
  due_date DATE,
  position INTEGER NOT NULL DEFAULT 0,
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create task_assignees junction table for multiple assignees
CREATE TABLE IF NOT EXISTS task_assignees (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

-- Create indexes for projects
CREATE INDEX IF NOT EXISTS projects_workspace_id_idx ON projects(workspace_id);
CREATE INDEX IF NOT EXISTS projects_status_idx ON projects(status);
CREATE INDEX IF NOT EXISTS projects_created_by_idx ON projects(created_by);

-- Create indexes for services
CREATE INDEX IF NOT EXISTS services_workspace_id_idx ON services(workspace_id);
CREATE INDEX IF NOT EXISTS services_project_id_idx ON services(project_id);
CREATE INDEX IF NOT EXISTS services_renewal_date_idx ON services(renewal_date);

-- Create indexes for task_columns
CREATE INDEX IF NOT EXISTS task_columns_workspace_id_idx ON task_columns(workspace_id);
CREATE INDEX IF NOT EXISTS task_columns_position_idx ON task_columns(position);

-- Create indexes for tasks
CREATE INDEX IF NOT EXISTS tasks_workspace_id_idx ON tasks(workspace_id);
CREATE INDEX IF NOT EXISTS tasks_project_id_idx ON tasks(project_id);
CREATE INDEX IF NOT EXISTS tasks_column_id_idx ON tasks(column_id);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx ON tasks(due_date);
CREATE INDEX IF NOT EXISTS tasks_created_by_idx ON tasks(created_by);

-- Create indexes for task_assignees
CREATE INDEX IF NOT EXISTS task_assignees_task_id_idx ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS task_assignees_user_id_idx ON task_assignees(user_id);

-- Create indexes for project_members
CREATE INDEX IF NOT EXISTS project_members_project_id_idx ON project_members(project_id);
CREATE INDEX IF NOT EXISTS project_members_user_id_idx ON project_members(user_id);
CREATE INDEX IF NOT EXISTS project_members_member_type_idx ON project_members(member_type);

-- Enable Row Level Security
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_assignees ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects
-- Owner can see all projects
-- Employees and clients can only see projects they're assigned to
CREATE POLICY "Users can view projects in their workspace"
  ON projects FOR SELECT
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND (
      -- Owner can see all projects
      get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
      OR
      -- Employees and clients can only see projects they're assigned to
      EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = projects.id
          AND pm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Only owners can create projects"
  ON projects FOR INSERT
  TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
  );

CREATE POLICY "Only owners can update projects"
  ON projects FOR UPDATE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
  );

CREATE POLICY "Only owners can delete projects"
  ON projects FOR DELETE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
  );

-- RLS Policies for project_members
-- Note: We allow all authenticated users to view project_members
-- The actual access control is enforced at the projects level
CREATE POLICY "Authenticated users can view project members"
  ON project_members FOR SELECT
  TO authenticated
  USING (true);

-- Create a function to check if user can manage project members (SECURITY DEFINER to avoid recursion)
CREATE OR REPLACE FUNCTION can_manage_project_members(project_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  project_workspace_id UUID;
  user_role TEXT;
BEGIN
  -- Get the workspace_id for this project
  SELECT workspace_id INTO project_workspace_id FROM projects WHERE id = project_uuid;

  IF project_workspace_id IS NULL THEN
    RETURN false;
  END IF;

  -- Get user's role in that workspace
  SELECT role INTO user_role FROM workspace_members
  WHERE workspace_id = project_workspace_id AND user_id = user_uuid;

  -- Only owners can manage project members
  RETURN user_role = 'owner';
END;
$$;

CREATE POLICY "Only owners can manage project members"
  ON project_members FOR ALL
  TO authenticated
  USING (can_manage_project_members(project_id, auth.uid()))
  WITH CHECK (can_manage_project_members(project_id, auth.uid()));

-- RLS Policies for services (all workspace members can access)
CREATE POLICY "Users can view services in their workspace"
  ON services FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can create services in their workspace"
  ON services FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can update services in their workspace"
  ON services FOR UPDATE
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can delete services in their workspace"
  ON services FOR DELETE
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

-- RLS Policies for task_columns (all workspace members can access)
CREATE POLICY "Users can view task columns in their workspace"
  ON task_columns FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can create task columns in their workspace"
  ON task_columns FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can update task columns in their workspace"
  ON task_columns FOR UPDATE
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Users can delete task columns in their workspace"
  ON task_columns FOR DELETE
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

-- RLS Policies for tasks
-- Owner can see all tasks
-- Employees and clients can only see tasks for their assigned projects
CREATE POLICY "Users can view tasks in their workspace"
  ON tasks FOR SELECT
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND (
      -- Owner can see all tasks
      get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
      OR
      -- Employees and clients can only see tasks for projects they're assigned to
      EXISTS (
        SELECT 1 FROM project_members pm
        WHERE pm.project_id = tasks.project_id
          AND pm.user_id = auth.uid()
      )
    )
  );

CREATE POLICY "Owner and assigned employees can create tasks"
  ON tasks FOR INSERT
  TO authenticated
  WITH CHECK (
    is_workspace_member(workspace_id, auth.uid()) AND (
      get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
      OR
      (
        get_user_role_in_workspace(workspace_id, auth.uid()) = 'employee' AND
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = tasks.project_id
            AND pm.user_id = auth.uid()
            AND pm.member_type = 'employee'
        )
      )
    )
  );

CREATE POLICY "Owner and assigned employees can update tasks"
  ON tasks FOR UPDATE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND (
      get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
      OR
      (
        get_user_role_in_workspace(workspace_id, auth.uid()) = 'employee' AND
        EXISTS (
          SELECT 1 FROM project_members pm
          WHERE pm.project_id = tasks.project_id
            AND pm.user_id = auth.uid()
            AND pm.member_type = 'employee'
        )
      )
    )
  );

CREATE POLICY "Only owner can delete tasks"
  ON tasks FOR DELETE
  TO authenticated
  USING (
    is_workspace_member(workspace_id, auth.uid()) AND
    get_user_role_in_workspace(workspace_id, auth.uid()) = 'owner'
  );

-- Create triggers for updated_at
DROP TRIGGER IF EXISTS set_projects_updated_at ON projects;
CREATE TRIGGER set_projects_updated_at
  BEFORE UPDATE ON projects
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_services_updated_at ON services;
CREATE TRIGGER set_services_updated_at
  BEFORE UPDATE ON services
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS set_tasks_updated_at ON tasks;
CREATE TRIGGER set_tasks_updated_at
  BEFORE UPDATE ON tasks
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- RLS Policies for task_assignees (all workspace members can access)
CREATE POLICY "Users can view task assignees in their workspace"
  ON task_assignees FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND is_workspace_member(t.workspace_id, auth.uid())
    )
  );

CREATE POLICY "Users can create task assignees in their workspace"
  ON task_assignees FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND is_workspace_member(t.workspace_id, auth.uid())
    )
  );

CREATE POLICY "Users can delete task assignees in their workspace"
  ON task_assignees FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM tasks t
      WHERE t.id = task_assignees.task_id
        AND is_workspace_member(t.workspace_id, auth.uid())
    )
  );
