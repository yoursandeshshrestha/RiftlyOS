import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { CloseIcon, SearchIcon, UserPlusIcon } from '@/components/icons';
import { Spinner } from '@/components/ui/spinner';
import { toast } from 'sonner';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface ManageChannelMembersDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  channelName: string;
}

export function ManageChannelMembersDialog({
  open,
  onOpenChange,
  channelId,
  channelName,
}: ManageChannelMembersDialogProps) {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [allMembers, setAllMembers] = useState<Member[]>([]);
  const [currentMembers, setCurrentMembers] = useState<Set<string>>(new Set());
  const [loadingMemberId, setLoadingMemberId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [addSearchQuery, setAddSearchQuery] = useState('');

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  useEffect(() => {
    if (!open || !activeWorkspace?.id || !channelId) return;

    const fetchData = async () => {
      const { data: workspaceMembers, error: membersError } = await supabase
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
        .eq('workspace_id', activeWorkspace.id);

      if (membersError) {
        console.error('Error fetching members:', membersError);
        return;
      }

      const membersList = (workspaceMembers || []).map((m: {
        user_id: string;
        role: string;
        profiles: { id: string; full_name: string; email: string } | null;
      }) => ({
        id: m.user_id,
        name: m.profiles?.full_name || 'Unknown',
        email: m.profiles?.email || '',
        role: m.role,
      }));

      setAllMembers(membersList);

      const { data: channelMembers, error: channelError } = await supabase
        .from('channel_members')
        .select('user_id')
        .eq('channel_id', channelId);

      if (channelError) {
        console.error('Error fetching channel members:', channelError);
        return;
      }

      const memberIds = new Set((channelMembers || []).map(m => m.user_id));
      setCurrentMembers(memberIds);
    };

    fetchData();
    setSearchQuery('');
    setAddSearchQuery('');
  }, [open, activeWorkspace?.id, channelId]);

  const addMember = async (memberId: string) => {
    setLoadingMemberId(memberId);
    try {
      const { error } = await supabase
        .from('channel_members')
        .insert({
          channel_id: channelId,
          user_id: memberId,
        });

      if (error) throw error;

      const newMembers = new Set(currentMembers);
      newMembers.add(memberId);
      setCurrentMembers(newMembers);

      toast.success('Member added to channel');
    } catch (error) {
      console.error('Error adding member:', error);
      toast.error('Failed to add member');
    } finally {
      setLoadingMemberId(null);
    }
  };

  const removeMember = async (memberId: string) => {
    if (memberId === user?.id) {
      toast.error('You cannot remove yourself from the channel');
      return;
    }

    setLoadingMemberId(memberId);
    try {
      const { error } = await supabase
        .from('channel_members')
        .delete()
        .eq('channel_id', channelId)
        .eq('user_id', memberId);

      if (error) throw error;

      const newMembers = new Set(currentMembers);
      newMembers.delete(memberId);
      setCurrentMembers(newMembers);

      toast.success('Member removed from channel');
    } catch (error) {
      console.error('Error removing member:', error);
      toast.error('Failed to remove member');
    } finally {
      setLoadingMemberId(null);
    }
  };

  const currentMembersList = useMemo(() => {
    const members = allMembers.filter(m => currentMembers.has(m.id));
    if (!searchQuery.trim()) return members;

    const query = searchQuery.toLowerCase();
    return members.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query)
    );
  }, [allMembers, currentMembers, searchQuery]);

  const availableMembers = useMemo(() => {
    const members = allMembers.filter(m => !currentMembers.has(m.id));
    if (!addSearchQuery.trim()) return members;

    const query = addSearchQuery.toLowerCase();
    return members.filter(m =>
      m.name.toLowerCase().includes(query) ||
      m.email.toLowerCase().includes(query)
    );
  }, [allMembers, currentMembers, addSearchQuery]);

  const totalMembers = allMembers.filter(m => currentMembers.has(m.id)).length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>#{channelName}</DialogTitle>
          <p className="text-sm text-muted-foreground">{totalMembers} {totalMembers === 1 ? 'member' : 'members'}</p>
        </DialogHeader>

        <Tabs defaultValue="members" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="members">Members</TabsTrigger>
            <TabsTrigger value="add">Add People</TabsTrigger>
          </TabsList>

          <TabsContent value="members" className="space-y-3">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search members..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[400px] space-y-1 overflow-y-auto rounded-md border">
              {currentMembersList.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  {searchQuery ? 'No members found' : 'No members yet'}
                </div>
              ) : (
                currentMembersList.map((member) => {
                  const isCurrentUser = member.id === user?.id;
                  const isLoading = loadingMemberId === member.id;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar className="size-8 shrink-0 rounded-md">
                          <AvatarFallback className="rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {member.name} {isCurrentUser && <span className="text-xs text-muted-foreground">(You)</span>}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">{member.role}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        onClick={() => removeMember(member.id)}
                        disabled={isCurrentUser || isLoading}
                      >
                        {isLoading ? <Spinner size="xs" /> : <CloseIcon className="size-4" />}
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="add" className="space-y-3">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search people to add..."
                value={addSearchQuery}
                onChange={(e) => setAddSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            <div className="max-h-[400px] space-y-1 overflow-y-auto rounded-md border">
              {availableMembers.length === 0 ? (
                <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                  {addSearchQuery ? 'No people found' : 'All workspace members are already in this channel'}
                </div>
              ) : (
                availableMembers.map((member) => {
                  const isLoading = loadingMemberId === member.id;
                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-muted/50"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <Avatar className="size-8 shrink-0 rounded-md">
                          <AvatarFallback className="rounded-md bg-primary/10 text-[10px] font-semibold text-primary">
                            {getInitials(member.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{member.name}</p>
                          <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                        </div>
                        <span className="shrink-0 text-xs capitalize text-muted-foreground">{member.role}</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => addMember(member.id)}
                        disabled={isLoading}
                        className="shrink-0 cursor-pointer"
                      >
                        {isLoading ? <Spinner size="xs" /> : <UserPlusIcon className="mr-1.5 size-4" />}
                        Add
                      </Button>
                    </div>
                  );
                })
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
