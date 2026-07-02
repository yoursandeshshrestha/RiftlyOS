import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import { LoaderIcon, PlusIcon, CloseIcon } from '@/components/icons';
import { toast } from 'sonner';
import { SelectChannelMembersDialog } from './SelectChannelMembersDialog';

interface Member {
  id: string;
  name: string;
  email: string;
  role: string;
}

interface CreateChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChannelCreated?: () => void;
}

export function CreateChannelDialog({ open, onOpenChange, onChannelCreated }: CreateChannelDialogProps) {
  const { activeWorkspace } = useWorkspace();
  const { user } = useAuth();
  const [channelName, setChannelName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [isMembersDialogOpen, setIsMembersDialogOpen] = useState(false);

  // Fetch workspace members
  useEffect(() => {
    if (!open || !activeWorkspace?.id) return;

    const fetchMembers = async () => {
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
        .eq('workspace_id', activeWorkspace.id);

      if (error) {
        console.error('Error fetching members:', error);
        return;
      }

      const membersList = (data || []).map((m: {
        user_id: string;
        role: string;
        profiles: { id: string; full_name: string; email: string } | null;
      }) => ({
        id: m.user_id,
        name: m.profiles?.full_name || 'Unknown',
        email: m.profiles?.email || '',
        role: m.role,
      }));

      setMembers(membersList);

      // Auto-select current user
      if (user?.id && !selectedMemberIds.includes(user.id)) {
        setSelectedMemberIds([user.id]);
      }
    };

    fetchMembers();
  }, [open, activeWorkspace?.id, user?.id]);

  const removeMember = (memberId: string) => {
    if (memberId === user?.id) {
      toast.error('You must be a member of the channel');
      return;
    }
    setSelectedMemberIds(prev => prev.filter(id => id !== memberId));
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  // Get selected member details
  const selectedMembers = members.filter(m => selectedMemberIds.includes(m.id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!channelName.trim()) {
      toast.error('Please enter a channel name');
      return;
    }

    if (!activeWorkspace || !user) {
      toast.error('Not ready to create channel');
      return;
    }

    setLoading(true);

    try {
      const memberIds = selectedMemberIds;

      const { data: channelData, error: channelError } = await supabase
        .from('channels')
        .insert({
          workspace_id: activeWorkspace.id,
          name: channelName,
          description: description || null,
          is_default: false,
          created_by: user.id,
        })
        .select()
        .single();

      if (channelError) throw channelError;

      // Add members to channel in Supabase
      const channelMembers = memberIds.map(memberId => ({
        channel_id: channelData.id,
        user_id: memberId,
      }));

      const { error: membersError } = await supabase
        .from('channel_members')
        .insert(channelMembers);

      if (membersError) throw membersError;

      toast.success('Channel created successfully!');
      setChannelName('');
      setDescription('');
      setSelectedMemberIds([]);
      onOpenChange(false);
      onChannelCreated?.();
    } catch (error) {
      console.error('Error creating channel:', error);
      toast.error('Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create New Channel</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Channel Name</Label>
            <Input
              id="name"
              placeholder="e.g. project-alpha"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description (optional)</Label>
            <Input
              id="description"
              placeholder="What is this channel about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Add Members</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsMembersDialogOpen(true)}
                disabled={loading}
                className="cursor-pointer"
              >
                <PlusIcon className="mr-2 size-4" />
                Add
              </Button>
            </div>

            {selectedMembers.length > 0 ? (
              <div className="space-y-2">
                {selectedMembers.map((member) => (
                  <div key={member.id} className="flex items-center justify-between rounded-md bg-muted/50 p-2">
                    <div className="flex items-center gap-2">
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">
                          {getInitials(member.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="text-sm font-medium">{member.name}</div>
                        <div className="text-xs text-muted-foreground">{member.email} • {member.role}</div>
                      </div>
                    </div>
                    {member.id !== user?.id && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeMember(member.id)}
                        disabled={loading}
                        className="cursor-pointer size-8 p-0"
                      >
                        <CloseIcon className="size-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                No members added
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />}
              Create Channel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Member Selection Dialog */}
      <SelectChannelMembersDialog
        open={isMembersDialogOpen}
        onOpenChange={setIsMembersDialogOpen}
        selectedIds={selectedMemberIds}
        currentUserId={user?.id || ''}
        onConfirm={setSelectedMemberIds}
      />
    </Dialog>
  );
}
