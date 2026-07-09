-- Persist task time estimates for table/detail display
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS estimated_minutes INTEGER;

COMMENT ON COLUMN tasks.estimated_minutes IS 'Estimated effort in minutes; null or 0 means no estimate set';
