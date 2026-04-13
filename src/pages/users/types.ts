export interface User {
  id: string
  full_name: string
  email: string
  role: 'owner' | 'employee' | 'client'
  created_at: string
}

export const roleStyles = {
  owner: 'bg-purple-100 text-purple-700 hover:bg-purple-100',
  employee: 'bg-blue-100 text-blue-700 hover:bg-blue-100',
  client: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
}
