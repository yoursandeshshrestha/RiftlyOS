import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { sidebarConfig } from '@/config/sidebar'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { useStream } from '@/contexts/StreamContext'
import { supabase } from '@/lib/supabase'
import { Input } from '@/components/ui/input'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import {
  SearchIcon,
  ChevronDownIcon,
  UsersIcon,
  PlusIcon,
  HashIcon,
} from '@/components/icons'
import { CreateChannelDialog } from './CreateChannelDialog'

interface WorkspaceMember {
  id: string
  name: string
  email: string
  role: string
}

interface Channel {
  id: string
  name: string
  stream_channel_id: string
  is_default: boolean
  unread?: number
}

interface SidebarProps {
  isCollapsed?: boolean
}

export function Sidebar({ isCollapsed = false }: SidebarProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const { client, isConnected } = useStream()
  const [members, setMembers] = useState<WorkspaceMember[]>([])
  const [clients, setClients] = useState<WorkspaceMember[]>([])
  const [channels, setChannels] = useState<Channel[]>([])
  const [isMembersOpen, setIsMembersOpen] = useState(true)
  const [isClientsOpen, setIsClientsOpen] = useState(true)
  const [isChannelsOpen, setIsChannelsOpen] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [isCreateChannelOpen, setIsCreateChannelOpen] = useState(false)
  const [isLoadingMembers, setIsLoadingMembers] = useState(true)
  const [isLoadingChannels, setIsLoadingChannels] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

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
      if (!activeWorkspace?.id || !user?.id) {
        setIsLoadingMembers(false)
        return
      }

      setIsLoadingMembers(true)

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
        setIsLoadingMembers(false)
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

      setIsLoadingMembers(false)
    }

    fetchMembers()
  }, [activeWorkspace?.id, user?.id])

  const fetchChannels = useCallback(async () => {
    if (!activeWorkspace?.id || !user?.id) {
      setIsLoadingChannels(false)
      return
    }

    setIsLoadingChannels(true)

    // Get channels where user is a member
    const { data: memberChannels, error } = await supabase
      .from('channel_members')
      .select(`
        channel_id,
        channels!inner (
          id,
          name,
          stream_channel_id,
          is_default,
          workspace_id
        )
      `)
      .eq('user_id', user.id)

    if (error) {
      console.error('Error fetching channels:', error)
      setIsLoadingChannels(false)
      return
    }

    // Filter by workspace and map to channel objects
    const workspaceChannels = (memberChannels || [])
      .map((mc: any) => mc.channels)
      .filter((ch: any) => ch.workspace_id === activeWorkspace.id)
      .sort((a: any, b: any) => {
        // Sort by is_default first, then by name
        if (a.is_default !== b.is_default) return b.is_default ? 1 : -1
        return a.name.localeCompare(b.name)
      })

    setChannels(workspaceChannels)
    setIsLoadingChannels(false)
  }, [activeWorkspace?.id, user?.id])

  useEffect(() => {
    fetchChannels()

    if (!user?.id) return

    // Set up real-time subscription for channel member changes
    const channelSubscription = supabase
      .channel(`channel-members-${user.id}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'channel_members',
          filter: `user_id=eq.${user.id}`
        },
        (payload) => {
          console.log('Channel membership changed, refreshing channels')
          fetchChannels()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channelSubscription)
    }
  }, [fetchChannels, user?.id])

  // Fetch unread counts from Stream.io
  useEffect(() => {
    if (!client || !isConnected || channels.length === 0) return

    const updateUnreadCounts = async () => {
      const channelIds = channels.map(ch => ch.stream_channel_id)

      try {
        const streamChannels = await client.queryChannels({
          id: { $in: channelIds },
          members: { $in: [client.userID!] }
        })

        const updatedChannels = channels.map(channel => {
          const streamChannel = streamChannels.find(sc => sc.id === channel.stream_channel_id)
          const unreadCount = streamChannel?.countUnread() || 0
          return { ...channel, unread: unreadCount }
        })

        setChannels(updatedChannels)
      } catch (error) {
        console.error('Error fetching unread counts:', error)
      }
    }

    updateUnreadCounts()

    // Listen for new messages to update unread counts
    const handleEvent = () => {
      updateUnreadCounts()
    }

    client.on('message.new', handleEvent)
    client.on('notification.mark_read', handleEvent)

    return () => {
      client.off('message.new', handleEvent)
      client.off('notification.mark_read', handleEvent)
    }
  }, [client, isConnected, channels.length])

  // Filter navigation items based on search query
  const filteredSidebarConfig = sidebarConfig.map(group => ({
    ...group,
    items: group.items.filter(item =>
      item.title.toLowerCase().includes(searchQuery.toLowerCase())
    )
  })).filter(group => group.items.length > 0)

  // Check if sections match search
  const showChannelsSection = !searchQuery || 'channels'.includes(searchQuery.toLowerCase())
  const showMembersSection = !searchQuery || 'members'.includes(searchQuery.toLowerCase())
  const showClientsSection = !searchQuery || 'clients'.includes(searchQuery.toLowerCase())

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

      {/* Search - Hide from clients */}
      {!isCollapsed && (isLoadingMembers || userRole !== 'client') && (
        <div className="px-3 pb-2">
          {isLoadingMembers ? (
            <Skeleton className="h-9 w-full rounded-md" />
          ) : (
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 cursor-text bg-sidebar-accent/50 pl-9 text-sm placeholder:text-muted-foreground/60"
              />
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex flex-col gap-2 py-2">
          {filteredSidebarConfig.map((group, groupIndex) => (
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

          {/* Channels Section */}
          {!isCollapsed && showChannelsSection && (isLoadingChannels || channels.length > 0) && (
            <div className="px-2 py-2">
              <Collapsible open={isChannelsOpen} onOpenChange={setIsChannelsOpen}>
                <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <HashIcon className="size-4" />
                  <span className="flex-1 truncate">Channels</span>
                  <ChevronDownIcon className={`size-4 opacity-60 transition-transform ${isChannelsOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 pl-2">
                  {isLoadingChannels ? (
                    <>
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-4 shrink-0" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ))}
                    </>
                  ) : channels.length > 0 ? (
                    <>
                      {channels.map((channel) => {
                        const isActive = location.pathname === '/messages' && location.hash === `#${channel.stream_channel_id}`
                        return (
                          <button
                            key={channel.id}
                            onClick={() => navigate(`/messages#${channel.stream_channel_id}`)}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${
                              isActive
                                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                : 'text-sidebar-foreground dark:text-gray-200 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                            }`}
                          >
                            <HashIcon className="size-4 shrink-0" />
                            <span className="truncate text-[11px] font-medium text-inherit">
                              {channel.name}
                            </span>
                            {(channel.unread ?? 0) > 0 && (
                              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                                {channel.unread! > 99 ? '99+' : channel.unread}
                              </span>
                            )}
                          </button>
                        )
                      })}
                      {isLoadingMembers ? (
                        <div className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-4" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ) : userRole === 'owner' ? (
                        <button
                          onClick={() => setIsCreateChannelOpen(true)}
                          className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground"
                        >
                          <PlusIcon className="size-4 opacity-60" />
                          <span className="opacity-60">Add channel</span>
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Members Section - Hide from clients */}
          {!isCollapsed && showMembersSection && (isLoadingMembers || userRole !== 'client') && (
            <div className="px-2 py-2">
              <Collapsible open={isMembersOpen} onOpenChange={setIsMembersOpen}>
                <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <UsersIcon className="size-4" />
                  <span className="flex-1 truncate">Members</span>
                  <ChevronDownIcon className={`size-4 opacity-60 transition-transform ${isMembersOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 pl-2">
                  {isLoadingMembers ? (
                    <>
                      {[...Array(3)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-5 rounded-md" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ))}
                    </>
                  ) : members.length > 0 ? (
                    <>
                      {members.map((member) => {
                        // Skip current user from DM list
                        if (member.id === user?.id) return null;

                        const isActive = location.pathname === '/messages' && location.hash === `#dm-${member.id}`;
                        return (
                          <button
                            key={member.id}
                            onClick={() => navigate(`/messages#dm-${member.id}`)}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${
                              isActive
                                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                : 'text-sidebar-foreground dark:text-gray-200 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                            }`}
                          >
                            <Avatar className="size-5 rounded-md">
                              <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px] text-sidebar-foreground">
                                {getInitials(member.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-[11px] font-medium text-inherit">
                              {member.name}
                            </span>
                          </button>
                        );
                      })}
                      {isLoadingMembers ? (
                        <div className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-4" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ) : userRole === 'owner' ? (
                        <button className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                          <PlusIcon className="size-4 opacity-60" />
                          <span className="opacity-60">Add new member</span>
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}

          {/* Clients Section - Owner only */}
          {!isCollapsed && showClientsSection && (isLoadingMembers || userRole === 'owner') && (
            <div className="px-2 py-2">
              <Collapsible open={isClientsOpen} onOpenChange={setIsClientsOpen}>
                <CollapsibleTrigger className="flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                  <UsersIcon className="size-4" />
                  <span className="flex-1 truncate">Clients</span>
                  <ChevronDownIcon className={`size-4 opacity-60 transition-transform ${isClientsOpen ? 'rotate-180' : ''}`} />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-1 space-y-0.5 pl-2">
                  {isLoadingMembers ? (
                    <>
                      {[...Array(2)].map((_, i) => (
                        <div key={i} className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-5 rounded-md" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ))}
                    </>
                  ) : clients.length > 0 ? (
                    <>
                      {clients.map((client) => {
                        const isActive = location.pathname === '/messages' && location.hash === `#dm-${client.id}`;
                        return (
                          <button
                            key={client.id}
                            onClick={() => navigate(`/messages#dm-${client.id}`)}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] transition-colors ${
                              isActive
                                ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                                : 'text-sidebar-foreground dark:text-gray-200 hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground'
                            }`}
                          >
                            <Avatar className="size-5 rounded-md">
                              <AvatarFallback className="rounded-md bg-sidebar-accent text-[9px] text-sidebar-foreground">
                                {getInitials(client.name)}
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-[11px] font-medium text-inherit">
                              {client.name}
                            </span>
                          </button>
                        );
                      })}
                      {isLoadingMembers ? (
                        <div className="flex items-center gap-2 px-2 py-1">
                          <Skeleton className="size-4" />
                          <Skeleton className="h-3 flex-1" />
                        </div>
                      ) : (
                        <button className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[11px] font-medium text-sidebar-foreground dark:text-gray-200 transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground">
                          <PlusIcon className="size-4 opacity-60" />
                          <span className="opacity-60">Add new client</span>
                        </button>
                      )}
                    </>
                  ) : null}
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>

      <CreateChannelDialog
        open={isCreateChannelOpen}
        onOpenChange={setIsCreateChannelOpen}
        onChannelCreated={fetchChannels}
      />
    </aside>
  )
}
