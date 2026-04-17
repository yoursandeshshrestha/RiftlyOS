export interface User {
  id: string
  full_name: string
  email: string
  role: 'owner' | 'employee' | 'client'
  created_at: string
}

export const roleStyles = {
  owner: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 hover:bg-purple-500/10',
  employee: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10',
  client: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10',
}
