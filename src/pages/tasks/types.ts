export type TaskPriority = 'low' | 'medium' | 'high'

export type TaskActivityType =
  | 'comment'
  | 'attachment_added'
  | 'attachment_removed'
  | 'label_added'
  | 'label_removed'
  | 'status_changed'
  | 'priority_changed'
  | 'assignee_changed'
  | 'due_date_changed'
  | 'created'

export interface TaskLabel {
  id: string
  workspace_id: string
  name: string
  color: string
  created_at: string
}

export interface TaskComment {
  id: string
  workspace_id: string
  task_id: string
  author_id: string
  body: string
  created_at: string
  updated_at: string
  author?: {
    id: string
    full_name: string
  }
}

export interface TaskAttachment {
  id: string
  workspace_id: string
  task_id: string
  uploaded_by: string
  file_name: string
  storage_path: string
  file_size: number | null
  mime_type: string | null
  created_at: string
  uploader?: {
    id: string
    full_name: string
  }
}

export interface TaskActivity {
  id: string
  workspace_id: string
  task_id: string
  actor_id: string
  activity_type: TaskActivityType
  body: string | null
  metadata: Record<string, unknown>
  created_at: string
  actor?: {
    id: string
    full_name: string
  }
}

export interface TaskColumn {
  id: string
  workspace_id: string
  name: string
  position: number
  created_at: string
}

export interface Task {
  id: string
  workspace_id: string
  project_id: string | null
  column_id: string
  title: string
  description: string | null
  priority: TaskPriority
  assigned_to: string | null
  due_date: string | null
  position: number
  estimated_minutes?: number | null
  created_at: string
  updated_at: string
  // Relations
  project?: {
    id: string
    name: string
  }
  assignees?: Array<{
    id: string
    full_name: string
    email: string
  }>
  labels?: TaskLabel[]
  logged_minutes?: number
  comment_count?: number
}

export const TASK_LABEL_COLORS = [
  '#6366f1',
  '#ec4899',
  '#f59e0b',
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ef4444',
  '#64748b',
] as const

export const TASK_PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' },
  { value: 'high', label: 'High', color: 'bg-red-500/10 text-red-700 dark:text-red-400' },
]
