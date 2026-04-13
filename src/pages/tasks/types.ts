export type TaskPriority = 'low' | 'medium' | 'high'

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
}

export const TASK_PRIORITIES: { value: TaskPriority; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400' },
  { value: 'medium', label: 'Medium', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' },
  { value: 'high', label: 'High', color: 'bg-red-500/10 text-red-700 dark:text-red-400' },
]
