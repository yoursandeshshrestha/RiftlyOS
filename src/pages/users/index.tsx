import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { UsersTable } from './components/UsersTable'
import type { User } from './types'

export function UsersPage() {
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [searchQuery, setSearchQuery] = useState('')
  const [users, setUsers] = useState<User[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)

  // Check if user is owner
  useEffect(() => {
    const checkRole = async () => {
      if (!activeWorkspace?.id || !user?.id) return

      const { data, error } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', activeWorkspace.id)
        .eq('user_id', user.id)
        .single()

      if (error) {
        console.error('Error checking role:', error)
        navigate('/dashboard')
        return
      }

      if ((data as { role: string })?.role !== 'owner') {
        navigate('/dashboard')
        return
      }

      setUserRole((data as { role: string })?.role)
    }

    checkRole()
  }, [activeWorkspace?.id, user?.id, navigate])

  useEffect(() => {
    if (activeWorkspace?.id && userRole === 'owner') {
      fetchUsers()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, userRole])

  const fetchUsers = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('workspace_members')
        .select(`
          user_id,
          role,
          joined_at,
          profiles!workspace_members_user_id_fkey (
            id,
            full_name,
            email,
            created_at
          )
        `)
        .eq('workspace_id', activeWorkspace.id)
        .order('joined_at', { ascending: false })

      if (error) throw error

      const usersData = (data || []).map((member: {
        user_id: string
        role: string
        joined_at: string
        profiles: {
          id: string
          full_name: string
          email: string
          created_at: string
        } | null
      }) => ({
        id: member.user_id,
        full_name: member.profiles?.full_name || 'Unknown',
        email: member.profiles?.email || '',
        role: member.role as 'owner' | 'employee' | 'client',
        created_at: member.joined_at,
      }))

      setUsers(usersData)
    } catch (error) {
      console.error('Error fetching users:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const filteredUsers = users.filter(
    (user) =>
      user.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      user.email.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground">
            Manage your team members and their roles.
          </p>
        </div>
        <Button className="cursor-pointer">
          <Plus className="mr-2 size-4" />
          Add User
        </Button>
      </div>

      {/* Users Table */}
      <UsersTable
        users={filteredUsers}
        isLoading={isLoading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        formatDate={formatDate}
      />
    </div>
  )
}
