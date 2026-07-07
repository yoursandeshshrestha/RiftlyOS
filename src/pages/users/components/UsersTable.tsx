import { Card, CardEyebrow } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { UsersTableRow } from './UsersTableRow'
import { SearchBar } from './SearchBar'
import type { User } from '../types'

interface UsersTableProps {
  users: User[]
  isLoading: boolean
  searchQuery: string
  onSearchChange: (value: string) => void
}

export function UsersTable({
  users,
  isLoading,
  searchQuery,
  onSearchChange,
}: UsersTableProps) {
  return (
    <Card variant="table">
      <CardEyebrow variant="table" title={`All Users (${users.length})`} action={<SearchBar value={searchQuery} onChange={onSearchChange} />} />
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
              <>
                {[...Array(6)].map((_, i) => (
                  <TableRow key={i} className="cursor-pointer">
                    <TableCell className="pl-6 text-[13px]">
                      <Skeleton className="h-[13px] w-36" />
                    </TableCell>
                    <TableCell className="text-[13px]">
                      <Skeleton className="h-[13px] w-44" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[18px] w-14 rounded-full" />
                    </TableCell>
                    <TableCell className="text-[13px]">
                      <Skeleton className="h-[13px] w-20" />
                    </TableCell>
                    <TableCell className="pr-6">
                      <Skeleton className="size-8 rounded-md" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : users.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                  No users found.
                </TableCell>
              </TableRow>
            ) : (
              users.map((user) => (
                <UsersTableRow key={user.id} user={user} />
              ))
            )}
          </TableBody>
        </Table>
    </Card>
  )
}
