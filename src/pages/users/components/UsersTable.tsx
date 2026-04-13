import { Card } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { UsersTableRow } from './UsersTableRow'
import { SearchBar } from './SearchBar'
import type { User } from '../types'

interface UsersTableProps {
  users: User[]
  isLoading: boolean
  searchQuery: string
  onSearchChange: (value: string) => void
  formatDate: (dateString: string) => string
}

export function UsersTable({
  users,
  isLoading,
  searchQuery,
  onSearchChange,
  formatDate,
}: UsersTableProps) {
  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          All Users ({users.length})
        </div>
        <SearchBar value={searchQuery} onChange={onSearchChange} />
      </div>
      <Card className="rounded-lg border py-0 ring-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">Name</TableHead>
              <TableHead className="text-[13px] font-medium">Email</TableHead>
              <TableHead className="text-[13px] font-medium">Role</TableHead>
              <TableHead className="text-[13px] font-medium">Joined Date</TableHead>
              <TableHead className="pr-6 text-[13px] font-medium">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  <div className="flex items-center justify-center">
                    <div className="inline-block size-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
                  </div>
                </TableCell>
              </TableRow>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <UsersTableRow key={user.id} user={user} formatDate={formatDate} />
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
