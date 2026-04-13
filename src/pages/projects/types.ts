export interface Service {
  id: string
  workspace_id: string
  project_id: string
  name: string
  mrr: number
  start_date: string
  renewal_date: string
  created_at: string
  updated_at: string
}

export interface Project {
  id: string
  workspace_id: string
  name: string
  client_name: string
  status: 'active' | 'paused' | 'completed'
  flags: string | null
  created_by: string
  created_at: string
  updated_at: string
  services?: Service[]
}

export const PROJECT_STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
] as const
