import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from './AuthContext'

interface Workspace {
  id: string
  name: string
  slug: string
  logo_url?: string | null
}

interface WorkspaceContextType {
  workspaces: Workspace[]
  activeWorkspace: Workspace | null
  userRole: 'owner' | 'employee' | 'client' | null
  isLoading: boolean
  createWorkspace: (name: string, slug: string) => Promise<void>
  switchWorkspace: (workspaceId: string) => void
  refreshWorkspaces: () => Promise<void>
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined)

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null)
  const [userRole, setUserRole] = useState<'owner' | 'employee' | 'client' | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchWorkspaces = async () => {
    if (!user) return

    try {
      setIsLoading(true)

      // Fetch user's workspaces through workspace_members
      const { data: members, error: membersError } = await supabase
        .from('workspace_members')
        .select(`
          workspace_id,
          workspaces (
            id,
            name,
            slug,
            logo_url
          )
        `)
        .eq('user_id', user.id)

      if (membersError) throw membersError

      // Transform the data - handle the nested workspaces object
      const workspacesData = (members || []).map((member: {
        workspace_id: string
        workspaces: {
          id: string
          name: string
          slug: string
          logo_url?: string | null
        } | null
      }) => {
        const workspace = member.workspaces

        return {
          id: workspace?.id || '',
          name: workspace?.name || '',
          slug: workspace?.slug || '',
          logo_url: workspace?.logo_url,
        }
      }).filter(w => w.id)

      setWorkspaces(workspacesData)

      // Set active workspace (first one or stored preference)
      const storedWorkspaceId = localStorage.getItem('activeWorkspaceId')
      const activeWs = storedWorkspaceId
        ? workspacesData.find(w => w.id === storedWorkspaceId)
        : workspacesData[0]

      setActiveWorkspace(activeWs || null)
    } catch (error) {
      console.error('Error fetching workspaces:', error)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchWorkspaces()
  }, [user])

  useEffect(() => {
    const fetchUserRole = async () => {
      if (!activeWorkspace?.id || !user?.id) {
        setUserRole(null)
        return
      }

      try {
        const { data, error } = await supabase
          .from('workspace_members')
          .select('role')
          .eq('workspace_id', activeWorkspace.id)
          .eq('user_id', user.id)
          .single()

        if (error) throw error

        setUserRole(data.role as 'owner' | 'employee' | 'client')
      } catch (error) {
        console.error('Error fetching user role:', error)
        setUserRole(null)
      }
    }

    fetchUserRole()
  }, [activeWorkspace?.id, user?.id])

  const createWorkspace = async (name: string, slug: string) => {
    try {
      const result = await (supabase.rpc as any)('create_workspace', {
        workspace_name: name,
        workspace_slug: slug,
      })

      if (result.error) throw result.error

      // Refresh workspaces list
      await fetchWorkspaces()
    } catch (error) {
      console.error('Error creating workspace:', error)
      throw error
    }
  }

  const switchWorkspace = useCallback((workspaceId: string) => {
    localStorage.setItem('activeWorkspaceId', workspaceId)

    const workspace = workspaces.find(w => w.id === workspaceId)
    if (workspace) {
      setActiveWorkspace(workspace)
    } else {
      // List may be stale (e.g. right after create) — refetch picks up localStorage
      void fetchWorkspaces()
    }
  }, [workspaces])

  const refreshWorkspaces = async () => {
    await fetchWorkspaces()
  }

  return (
    <WorkspaceContext.Provider
      value={{
        workspaces,
        activeWorkspace,
        userRole,
        isLoading,
        createWorkspace,
        switchWorkspace,
        refreshWorkspaces,
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  )
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext)
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider')
  }
  return context
}
