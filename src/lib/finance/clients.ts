import { supabase } from '../supabase'

export interface WorkspaceClient {
  id: string
  fullName: string
  email: string
}

export async function getWorkspaceClients(
  workspaceId: string,
): Promise<WorkspaceClient[]> {
  const { data, error } = await supabase
    .from('workspace_members')
    .select(`
      user_id,
      profiles!workspace_members_user_id_fkey (
        id,
        full_name,
        email
      )
    `)
    .eq('workspace_id', workspaceId)
    .eq('role', 'client')
    .order('joined_at', { ascending: true })

  if (error) throw error

  return (data ?? [])
    .map((member) => {
      const profile = member.profiles as {
        id: string
        full_name: string
        email: string
      } | null

      if (!profile?.email) return null

      return {
        id: member.user_id,
        fullName: profile.full_name,
        email: profile.email,
      }
    })
    .filter((client): client is WorkspaceClient => client !== null)
}
