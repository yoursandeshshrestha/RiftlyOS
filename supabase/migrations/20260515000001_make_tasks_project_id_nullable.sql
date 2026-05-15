-- Make project_id nullable in tasks table
-- This allows tasks to exist without being assigned to a project

ALTER TABLE tasks
  ALTER COLUMN project_id DROP NOT NULL;
