import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sidebarConfig } from '@/config/sidebar'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Search, ChevronDown, Users, Plus } from 'lucide-react'

interface WorkspaceMember {
  id: string
  name: string
  email: string
  role: string
}

interface SidebarProps {
  isCollapsed?: boolean
}

export function Sidebar({ isCollapsed = false }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [clients, setClients] = useState<WorkspaceMember[]>([])
  const [isMembersOpen, setIsMembersOpen] = useState(true)
  const [isClientsOpen, setIsClientsOpen] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  useEffect(() => {
    const fetchMembers = async () => {
      if (!activeWorkspace?.id || !user?.id) return

      const { data, error } = await supabase
        .from('workspace_members')
        .select(`
          user_id,
          role,
          profiles!workspace_members_user_id_fkey (
            id,
            full_name,
            email
          )
        `)
        .eq('workspace_id', activeWorkspace.id)

      if (error) {
        console.error('Error fetching members:', error)
        return
      }

      const allMembers = (data || []).map((member: {
        user_id: string
        role: string
        profiles: {
          id: string
          full_name: string
          email: string
        } | null
      }) => ({
        id: member.user_id,
        name: member.profiles?.full_name || 'Unknown',
        email: member.profiles?.email || '',
        role: member.role,
      }))

      // Get current user's role
      const currentUserMember = allMembers.find(m => m.id === user.id)
      setUserRole(currentUserMember?.role || null)

      // Filter members (owner and employee only)
      const membersData = allMembers.filter(m => m.role === 'owner' || m.role === 'employee')
      setMembers(membersData)

      // Filter clients
      const clientsData = allMembers.filter(m => m.role === 'client')
      setClients(clientsData)
    }

    fetchMembers()
  }, [activeWorkspace?.id, user?.id])

  return (
    <aside className={`flex h-screen flex-col border-r border-sidebar-border bg-sidebar  text-sidebar-foreground transition-all duration-300 ${
      isCollapsed ? 'w-16' : 'w-64'
    }`}>
      {/* Workspace Name */}
      {!isCollapsed && (
        <div className="px-3 py-4">
          <span className="text-lg font-semibold text-sidebar-foreground dark:text-gray-100">
            {activeWorkspace?.name || 'Workspace'}
          </span>
        </div>
      )}

      {/* Search */}
      {!isCollapsed && (
        <div className="px-3 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search..."
              className="h-9 cursor-text bg-sidebar-accent/50 pl-9 text-sm placeholder:text-muted-foreground/60"
            />
          </div>
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-2 py-2">
          {sidebarConfig.map((group, groupIndex) => (
            <div key={groupIndex}>
              {!isCollapsed && (
                <div className="px-3 py-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/70 dark:text-gray-400">
                    {group.label} 
                  </span>
                </div>
              )}
              <div className="space-y-0.5 px-2">
                {group.items.map((item) => {
                  // Skip owner-only items if user is not owner
                  if (item.ownerOnly && userRole !== 'owner') {
                    return null
                  }

                  // Skip non-client items if user is a client
                  if (item.excludeClient && userRole === 'client') {
                    return null
                  }

                  const isActive = item.href ? location.pathname === item.href : false

                  return (
                    <button
                      key={item.href}
                      onClick={() => item.href && navigate(item.href)}
                      className={`group flex h-8 w-full cursor-pointer items-center overflow-hidden rounded-md p-1.5 text-left text-[13px] transition-colors ${
                        isCollapsed ? 'justify-center px-2' : 'gap-2 pl-2'
                      } ${
                        isActive
                          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                          : 'font-medium text-sidebar-foreground dark:text-gray-200 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                      }`}
                    >
                      {item.icon}
                      {!isCollapsed && (
                        <span className="flex-1 truncate text-inherit">
                          {item.title}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          {/* Members Section */}
          {!isCollapsed && (
            <div className="px-2 py-2">
              <Collapsible open={isMembersOpen} onOpenChange={setIsMembersOpen}>
                <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <Users className="size-4" />
                  <span className="flex-1 truncate">Members</span>
                  <ChevronDown className={`size-4 transition-transform ${isMembersOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 pl-2">
                  {members.map((member) => (
                    <div
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    >
                      <Avatar className="size-5 rounded-md">
                        <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px] text-sidebar-foreground">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-[11px] font-medium text-inherit">
                        {member.name}
                      </span>
                    </div>
                  ))}
                  <button className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                    <Plus className="size-4" />
                    <span>Add new member</span>
                  </button>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Clients Section */}
          {!isCollapsed && (
            <div className="px-2 py-2">
              <Collapsible open={isClientsOpen} onOpenChange={setIsClientsOpen}>
                <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <Users className="size-4" />
                  <span className="flex-1 truncate">Clients</span>
                  <ChevronDown className={`size-4 transition-transform ${isClientsOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 pl-2">
                  {clients.map((client) => (
                    <div
                      key={client.id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                    >
                      <Avatar className="size-5 rounded-md">
                        <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px] text-sidebar-foreground">
                          {getInitials(client.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate text-[11px] font-medium text-inherit">
                        {client.name}
                      </span>
                    </div>
                  ))}
                  <button className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                    <Plus className="size-4" />
                    <span>Add new client</span>
                  </button>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
