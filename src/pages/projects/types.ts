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

export interface ProjectMember {
  id: string
  project_id: string
  user_id: string
  member_type: 'client' | 'employee'
  created_at: string
  profile?: {
    id: string
    full_name: string
    email: string
    avatar_url: string | null
  }
}

export interface Project {
  id: string
  workspace_id: string
  name: string
  status: 'active' | 'paused' | 'completed'
  flags: string | null
  created_by: string
  created_at: string
  updated_at: string
  services?: Service[]
  members?: ProjectMember[]
}

export const PROJECT_STATUSES = [
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
] as const
