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
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useStream } from '@/contexts/StreamContext';
import { supabase } from '@/lib/supabase';
import { LoaderIcon } from '@/components/icons';
import { toast } from 'sonner';

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
  const { client } = useStream();
  const [channelName, setChannelName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<Member[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

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
      if (user?.id) {
        setSelectedMembers(new Set([user.id]));
      }
    };

    fetchMembers();
  }, [open, activeWorkspace?.id, user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!channelName.trim()) {
      toast.error('Please enter a channel name');
      return;
    }

    if (!activeWorkspace || !client || !user) {
      toast.error('Not ready to create channel');
      return;
    }

    setLoading(true);

    try {
      const streamChannelId = `${activeWorkspace.id}-${channelName.toLowerCase().replace(/\s+/g, '-')}`;
      const memberIds = Array.from(selectedMembers);

      // Create channel in Stream.io
      const channel = client.channel('messaging', streamChannelId, {
        name: channelName,
        description: description || undefined,
        members: memberIds,
      });

      await channel.create();

      // Create channel in Supabase
      const { data: channelData, error: channelError } = await supabase
        .from('channels')
        .insert({
          workspace_id: activeWorkspace.id,
          stream_channel_id: streamChannelId,
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
      setSelectedMembers(new Set());
      onOpenChange(false);
      onChannelCreated?.();
    } catch (error) {
      console.error('Error creating channel:', error);
      toast.error('Failed to create channel');
    } finally {
      setLoading(false);
    }
  };

  const toggleMember = (memberId: string) => {
    const newSelected = new Set(selectedMembers);
    if (newSelected.has(memberId)) {
      // Don't allow removing current user
      if (memberId === user?.id) {
        toast.error('You must be a member of the channel');
        return;
      }
      newSelected.delete(memberId);
    } else {
      newSelected.add(memberId);
    }
    setSelectedMembers(newSelected);
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

          <div className="space-y-2">
            <Label>Add Members</Label>
            <div className="max-h-48 space-y-2 overflow-y-auto rounded-md border p-3">
              {members.map((member) => (
                <div key={member.id} className="flex items-center space-x-2">
                  <Checkbox
                    id={member.id}
                    checked={selectedMembers.has(member.id)}
                    onCheckedChange={() => toggleMember(member.id)}
                    disabled={loading || member.id === user?.id}
                  />
                  <label
                    htmlFor={member.id}
                    className="flex-1 cursor-pointer text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {member.name}
                    <span className="ml-2 text-xs text-muted-foreground">
                      ({member.role})
                    </span>
                  </label>
                </div>
              ))}
            </div>
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
    </Dialog>
  );
}
