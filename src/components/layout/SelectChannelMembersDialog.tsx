import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { SearchIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Skeleton } from '@/components/ui/skeleton'

interface Member {
  user_id: string
  full_name: string
  email: string
  role: string
}

interface SelectChannelMembersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedIds: string[]
  currentUserId: string
  onConfirm: (selectedIds: string[]) => void
}

export function SelectChannelMembersDialog({
  open,
  onOpenChange,
  selectedIds,
  currentUserId,
  onConfirm,
}: SelectChannelMembersDialogProps) {
  const { activeWorkspace } = useWorkspace()
  const [searchQuery, setSearchQuery] = useState('')
  const [members, setMembers] = useState<Member[]>([])
  const [filteredMembers, setFilteredMembers] = useState<Member[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [tempSelectedIds, setTempSelectedIds] = useState<string[]>([])

  // Initialize temp selection with current selection
  useEffect(() => {
    if (open) {
      setTempSelectedIds(selectedIds)
      setSearchQuery('')
    }
  }, [open, selectedIds])

  // Fetch members
  useEffect(() => {
    const fetchMembers = async () => {
      if (!activeWorkspace?.id || !open) return

      setIsLoading(true)
      try {
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
          .limit(50)

        if (error) throw error

        const membersList = (data || []).map((m: any) => ({
          user_id: m.user_id,
          full_name: m.profiles?.full_name || 'Unknown',
          email: m.profiles?.email || '',
          role: m.role,
        }))

        setMembers(membersList)
        setFilteredMembers(membersList.slice(0, 5))
      } catch (error) {
        console.error('Error fetching members:', error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchMembers()
  }, [activeWorkspace?.id, open])

  // Filter members based on search
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredMembers(members.slice(0, 5))
      return
    }

    const query = searchQuery.toLowerCase()
    const filtered = members.filter(
      m =>
        m.full_name.toLowerCase().includes(query) ||
        m.email.toLowerCase().includes(query)
    )
    setFilteredMembers(filtered)
  }, [searchQuery, members])

  const toggleMember = (userId: string) => {
    // Don't allow removing current user
    if (userId === currentUserId && tempSelectedIds.includes(userId)) {
      return
    }

    setTempSelectedIds(prev =>
      prev.includes(userId)
        ? prev.filter(id => id !== userId)
        : [...prev, userId]
    )
  }

  const handleConfirm = () => {
    // Ensure current user is always included
    const finalSelection = tempSelectedIds.includes(currentUserId)
      ? tempSelectedIds
      : [...tempSelectedIds, currentUserId]

    onConfirm(finalSelection)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Channel Members</DialogTitle>
          <DialogDescription>
            Search and select members to add to this channel
          </DialogDescription>
        </DialogHeader>

        {/* Search */}
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search members..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="cursor-text pl-9"
          />
        </div>

        {/* Members Table */}
        <div className="max-h-[400px] overflow-y-auto rounded-md border">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="size-4" />
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          ) : filteredMembers.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              No members found
            </p>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-muted/50">
                <tr className="border-b">
                  <th className="w-12 p-3 text-left"></th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Name</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Email</th>
                  <th className="p-3 text-left text-xs font-medium text-muted-foreground">Role</th>
                </tr>
              </thead>
              <tbody>
                {filteredMembers.map((member) => (
                  <tr
                    key={member.user_id}
                    className="border-b last:border-0 hover:bg-muted/50 transition-colors"
                  >
                    <td className="p-3">
                      <Checkbox
                        id={`member-${member.user_id}`}
                        checked={tempSelectedIds.includes(member.user_id)}
                        onCheckedChange={() => toggleMember(member.user_id)}
                        disabled={member.user_id === currentUserId}
                        className="cursor-pointer"
                      />
                    </td>
                    <td className="p-3">
                      <label
                        htmlFor={`member-${member.user_id}`}
                        className="cursor-pointer text-sm font-medium"
                      >
                        {member.full_name}
                      </label>
                    </td>
                    <td className="p-3">
                      <span className="text-sm text-muted-foreground">{member.email}</span>
                    </td>
                    <td className="p-3">
                      <span className="text-xs text-muted-foreground capitalize">{member.role}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Selected Count */}
        <div className="text-sm text-muted-foreground">
          {tempSelectedIds.length} member(s) selected
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="cursor-pointer"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            className="cursor-pointer"
          >
            Add Selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
