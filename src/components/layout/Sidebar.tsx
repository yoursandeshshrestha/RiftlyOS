import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sidebarConfig } from '@/config/sidebar'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { getChannelUnreadCount } from '@/lib/messaging/readState'
import { channelHash } from '@/lib/messaging/parseHash'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  ChevronDownIcon,
  UsersIcon,
  PlusIcon,
  HashIcon,
  MoreHorizontalIcon,
} from '@/components/icons'
import { CreateChannelDialog } from './CreateChannelDialog'
import { AddUserDialog } from '@/components/dialogs/AddUserDialog'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { ProfileDropdown } from './ProfileDropdown'
import { cn } from '@/lib/utils'

interface WorkspaceMember {
  id: string
  name: string
  email: string
  role: string
}

interface Channel {
  id: string
  name: string
  is_default: boolean
  unread?: number
}

interface SidebarProps {
  className?: string
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

function NavItem({
  active,
  collapsed,
  onClick,
  icon,
  label,
  badge,
}: {
  active?: boolean
  collapsed?: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
  badge?: number
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={cn(
        'flex w-full cursor-pointer items-center rounded-md text-[13px] transition-colors',
        collapsed ? 'h-8 justify-center' : 'h-8 gap-2 px-2',
        active
          ? 'bg-sidebar-accent font-medium text-primary'
          : 'text-sidebar-foreground hover:bg-sidebar-accent/60'
      )}
    >
      {icon}
      {!collapsed && (
        <>
          <span className="flex-1 truncate text-left">{label}</span>
          {badge != null && badge > 0 && (
            <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-foreground/10 px-1 text-[10px] font-medium">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </>
      )}
    </button>
  )
}

export function Sidebar({ className, isCollapsed = false, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeWorkspace, isLoading: isWorkspaceLoading } = useWorkspace()
  const { user } = useAuth()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [clients, setClients] = useState<WorkspaceMember[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [isNavOpen, setIsNavOpen] = useState(true)
  const [isChannelsOpen, setIsChannelsOpen] = useState(false)
  const [isMembersOpen, setIsMembersOpen] = useState(false)
  const [isClientsOpen, setIsClientsOpen] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false)
  const [isAddMemberDialogOpen, setIsAddMemberDialogOpen] = useState(false)
  const [isAddClientDialogOpen, setIsAddClientDialogOpen] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(true)
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)

  const isLoading = isWorkspaceLoading || isLoadingMembers || isLoadingChannels
  const collapsed = isCollapsed

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2)

  useEffect(() => {
    const fetchMembers = async () => {
      if (!activeWorkspace?.id || !user?.id) return
      setIsLoadingMembers(true)

      const { data, error } = await supabase
        .from('workspace_members')
        .select(`
          user_id,
          role,
          profiles!workspace_members_user_id_fkey ( id, full_name, email )
        `)
        .eq('workspace_id', activeWorkspace.id)

      if (error) {
        console.error('Error fetching members:', error)
        setIsLoadingMembers(false)
        return
      }

      const allMembers = (data || []).map((member: {
        user_id: string
        role: string
        profiles: { id: string; full_name: string; email: string } | null
      }) => ({
        id: member.user_id,
        name: member.profiles?.full_name || 'Unknown',
        email: member.profiles?.email || '',
        role: member.role,
      }))

      const currentUserMember = allMembers.find((m) => m.id === user.id)
      setUserRole(currentUserMember?.role || null)

      if (currentUserMember?.role === 'client') {
        const { data: clientProjects } = await supabase
          .from('project_members')
          .select('project_id')
          .eq('user_id', user.id)
          .eq('member_type', 'client')

        const projectIds = (clientProjects || []).map((p) => p.project_id)
        const { data: projectEmployees } = await supabase
          .from('project_members')
          .select('user_id')
          .in('project_id', projectIds)
          .eq('member_type', 'employee')

        const employeeIds = new Set((projectEmployees || []).map((e) => e.user_id))
        const owner = allMembers.find((m) => m.role === 'owner')
        const assignedEmployees = allMembers.filter(
          (m) => m.role === 'employee' && employeeIds.has(m.id)
        )
        setMembers(owner ? [owner, ...assignedEmployees] : assignedEmployees)
        setClients([])
      } else {
        setMembers(allMembers.filter((m) => m.role === 'owner' || m.role === 'employee'))
        setClients(allMembers.filter((m) => m.role === 'client'))
      }

      setIsLoadingMembers(false)
    }

    fetchMembers()
  }, [activeWorkspace?.id, user?.id])

  const fetchChannels = useCallback(async () => {
    if (!activeWorkspace?.id || !user?.id) return
    setIsLoadingChannels(true)

    const { data: memberChannels, error } = await supabase
      .from('channel_members')
      .select(`channel_id, channels!inner ( id, name, is_default, workspace_id )`)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error fetching channels:', error)
      setIsLoadingChannels(false)
      return
    }

    const workspaceChannels: Channel[] = (memberChannels || [])
      .map((mc: { channels: { id: string; name: string; is_default: boolean | null; workspace_id: string } }) => ({
        id: mc.channels.id,
        name: mc.channels.name,
        is_default: mc.channels.is_default ?? false,
        workspace_id: mc.channels.workspace_id,
      }))
      .filter((ch) => ch.workspace_id === activeWorkspace.id)
      .map(({ id, name, is_default }) => ({ id, name, is_default }))
      .sort((a, b) => {
        if (a.is_default !== b.is_default) return b.is_default ? 1 : -1
        return a.name.localeCompare(b.name)
      })

    setChannels(workspaceChannels)
    setIsLoadingChannels(false)
  }, [activeWorkspace?.id, user?.id])

  useEffect(() => {
    fetchChannels()
    if (!user?.id) return

    const channelTopic = `channel-members-${user.id}`
    const staleChannel = supabase.getChannels().find((ch) => ch.topic === `realtime:${channelTopic}`)
    if (staleChannel) supabase.removeChannel(staleChannel)

    const channelSubscription = supabase
      .channel(channelTopic)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'channel_members', filter: `user_id=eq.${user.id}` }, fetchChannels)
      .subscribe()

    return () => { supabase.removeChannel(channelSubscription) }
  }, [fetchChannels, user?.id])

  useEffect(() => {
    if (!user?.id || channels.length === 0) return

    const updateUnreadCounts = async () => {
      setChannels(await Promise.all(
        channels.map(async (channel) => ({
          ...channel,
          unread: await getChannelUnreadCount(channel.id, user.id),
        }))
      ))
    }

    void updateUnreadCounts()

    const topic = `sidebar-unread-${user.id}`
    const stale = supabase.getChannels().find((ch) => ch.topic === `realtime:${topic}`)
    if (stale) supabase.removeChannel(stale)

    const subscription = supabase
      .channel(topic)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, () => { void updateUnreadCounts() })
      .subscribe()

    return () => { supabase.removeChannel(subscription) }
  }, [user?.id, channels.length])

  const navItems = sidebarConfig[0].items.filter((item) => {
    if (item.ownerOnly && userRole !== 'owner') return false
    if (item.excludeClient && userRole === 'client') return false
    return true
  })

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col border-r border-border-subtle bg-sidebar text-sidebar-foreground',
        collapsed ? 'w-14' : 'w-56',
        className
      )}
    >
      <WorkspaceSwitcher
        isLoading={isLoading}
        isCollapsed={collapsed}
        onToggleCollapse={onToggleCollapse}
      />

      <div className="flex-1 overflow-y-auto px-1.5 py-1">
        {isLoading ? (
          <div className="space-y-1 p-1">
            {[...Array(6)].map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded-md" />
            ))}
          </div>
        ) : (
          <>
            {!collapsed ? (
              <Collapsible open={isNavOpen} onOpenChange={setIsNavOpen}>
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground">
                  <ChevronDownIcon className={cn('size-3 transition-transform', !isNavOpen && '-rotate-90')} />
                  <span>{sidebarConfig[0].label}</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-px">
                  {navItems.map((item) => (
                    <NavItem
                      key={item.href}
                      active={location.pathname === item.href}
                      onClick={() => navigate(item.href)}
                      icon={item.icon}
                      label={item.title}
                    />
                  ))}
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <div className="space-y-px">
                {navItems.map((item) => (
                  <NavItem
                    key={item.href}
                    collapsed
                    active={location.pathname === item.href}
                    onClick={() => navigate(item.href)}
                    icon={item.icon}
                    label={item.title}
                  />
                ))}
              </div>
            )}

            {!collapsed && channels.length > 0 && (
              <Collapsible open={isChannelsOpen} onOpenChange={setIsChannelsOpen} className="mt-2">
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground">
                  <ChevronDownIcon className={cn('size-3 transition-transform', !isChannelsOpen && '-rotate-90')} />
                  <HashIcon className="size-3.5" />
                  <span>Channels</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-px">
                  {channels.map((channel) => {
                    const hash = channelHash(channel.id)
                    const isActive = location.pathname === '/messages' && location.hash === `#${hash}`
                    return (
                      <NavItem
                        key={channel.id}
                        active={isActive}
                        onClick={() => navigate(`/messages#${hash}`)}
                        icon={<HashIcon className="size-4 shrink-0" />}
                        label={channel.name}
                        badge={channel.unread}
                      />
                    )
                  })}
                  {userRole === 'owner' && (
                    <button
                      type="button"
                      onClick={() => setIsCreateChannelOpen(true)}
                      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    >
                      <PlusIcon className="size-3.5" />
                      <span>Add channel</span>
                    </button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {!collapsed && members.length > 0 && (
              <Collapsible open={isMembersOpen} onOpenChange={setIsMembersOpen} className="mt-1">
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground">
                  <ChevronDownIcon className={cn('size-3 transition-transform', !isMembersOpen && '-rotate-90')} />
                  <UsersIcon className="size-3.5" />
                  <span>Members</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-px">
                  {members.map((member) => {
                    if (member.id === user?.id) return null
                    const isActive = location.pathname === '/messages' && location.hash === `#dm-${member.id}`
                    return (
                      <NavItem
                        key={member.id}
                        active={isActive}
                        onClick={() => navigate(`/messages#dm-${member.id}`)}
                        icon={
                          <Avatar className="size-5 rounded-md">
                            <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px]">
                              {getInitials(member.name)}
                            </AvatarFallback>
                          </Avatar>
                        }
                        label={member.name}
                      />
                    )
                  })}
                  {userRole === 'owner' && (
                    <button
                      type="button"
                      onClick={() => setIsAddMemberDialogOpen(true)}
                      className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                    >
                      <PlusIcon className="size-3.5" />
                      <span>Add member</span>
                    </button>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            {!collapsed && userRole === 'owner' && clients.length > 0 && (
              <Collapsible open={isClientsOpen} onOpenChange={setIsClientsOpen} className="mt-1">
                <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-1 px-2 py-1.5 text-xs text-muted-foreground hover:text-sidebar-foreground">
                  <ChevronDownIcon className={cn('size-3 transition-transform', !isClientsOpen && '-rotate-90')} />
                  <UsersIcon className="size-3.5" />
                  <span>Clients</span>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-px">
                  {clients.map((client) => {
                    const isActive = location.pathname === '/messages' && location.hash === `#dm-${client.id}`
                    return (
                      <NavItem
                        key={client.id}
                        active={isActive}
                        onClick={() => navigate(`/messages#dm-${client.id}`)}
                        icon={
                          <Avatar className="size-5 rounded-md">
                            <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px]">
                              {getInitials(client.name)}
                            </AvatarFallback>
                          </Avatar>
                        }
                        label={client.name}
                      />
                    )
                  })}
                  <button
                    type="button"
                    onClick={() => setIsAddClientDialogOpen(true)}
                    className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 text-xs text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                  >
                    <PlusIcon className="size-3.5" />
                    <span>Add client</span>
                  </button>
                </CollapsibleContent>
              </Collapsible>
            )}
          </>
        )}
      </div>

      {user && (
        <div className={cn('flex items-center gap-2 p-2', collapsed && 'justify-center')}>
          <Avatar className="size-7 shrink-0 rounded-full">
            <AvatarFallback className="rounded-full bg-sidebar-accent text-[10px]">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{user.name}</span>
              <ProfileDropdown align="end" side="top">
                <button
                  type="button"
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground"
                >
                  <MoreHorizontalIcon className="size-4" />
                </button>
              </ProfileDropdown>
            </>
          )}
        </div>
      )}

      <CreateChannelDialog open={isCreateChannelOpen} onOpenChange={setIsCreateChannelOpen} onChannelCreated={fetchChannels} />
      <AddUserDialog
        open={isAddMemberDialogOpen}
        onOpenChange={setIsAddMemberDialogOpen}
        defaultRole="employee"
        onSuccess={() => { setIsAddMemberDialogOpen(false); window.location.reload() }}
      />
      <AddUserDialog
        open={isAddClientDialogOpen}
        onOpenChange={setIsAddClientDialogOpen}
        defaultRole="client"
        onSuccess={() => { setIsAddClientDialogOpen(false); window.location.reload() }}
      />
    </aside>
  )
}
