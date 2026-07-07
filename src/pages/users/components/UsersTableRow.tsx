import { TableCell, TableRow } from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontalIcon } from '@/components/icons'
import type { User } from '../types'
import { roleStyles } from '../types'
import { formatDateTime } from '@/lib/date'

interface UsersTableRowProps {
  user: User
}

export function UsersTableRow({ user }: UsersTableRowProps) {
  return (
    <TableRow className="cursor-pointer">
      <TableCell className="pl-6 text-[13px] font-medium">{user.full_name}</TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {user.email}
      </TableCell>
      <TableCell>
        <Badge variant="secondary" className={`text-[11px] capitalize ${roleStyles[user.role]}`}>
          {user.role}
        </Badge>
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {formatDateTime(user.created_at)}
      </TableCell>
      <TableCell className="pr-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-8 cursor-pointer">
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem className="cursor-pointer">Edit</DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer">View Details</DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer text-destructive">
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
