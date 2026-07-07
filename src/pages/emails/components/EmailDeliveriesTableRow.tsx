import { TableCell, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontalIcon, RefreshIcon } from '@/components/icons'
import { EmailStatusBadge } from './EmailStatusBadge'
import { EmptyValue } from '@/components/ui/empty-value'
import { EMAIL_TEMPLATE_LABELS, type EmailDelivery } from '../types'
import { formatDateTime } from '@/lib/date'

interface EmailDeliveriesTableRowProps {
  delivery: EmailDelivery
  isRetrying: boolean
  onSelect: (delivery: EmailDelivery) => void
  onRetry: (delivery: EmailDelivery) => void
}

export function EmailDeliveriesTableRow({
  delivery,
  isRetrying,
  onSelect,
  onRetry,
}: EmailDeliveriesTableRowProps) {
  const canRetry = delivery.status === 'failed' || delivery.status === 'pending'

  return (
    <TableRow
      className="cursor-pointer hover:bg-muted/50"
      onClick={() => onSelect(delivery)}
    >
      <TableCell className="pl-6 text-[13px] font-medium">{delivery.recipient}</TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {EMAIL_TEMPLATE_LABELS[delivery.template] ?? delivery.template}
      </TableCell>
      <TableCell className="max-w-[220px] truncate text-[13px]">
        {delivery.subject?.trim() ? delivery.subject : <EmptyValue />}
      </TableCell>
      <TableCell>
        <EmailStatusBadge status={delivery.status} />
      </TableCell>
      <TableCell className="max-w-[200px] truncate text-[13px]">
        {delivery.status === 'failed' && delivery.error_message?.trim() ? (
          <span className="text-muted-foreground">{delivery.error_message}</span>
        ) : (
          <EmptyValue />
        )}
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {formatDateTime(delivery.created_at)}
      </TableCell>
      <TableCell className="text-[13px] text-muted-foreground">
        {delivery.retry_count ?? 0}
      </TableCell>
      <TableCell className="pr-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer"
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontalIcon className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer"
              onClick={(e) => {
                e.stopPropagation()
                onSelect(delivery)
              }}
            >
              View details
            </DropdownMenuItem>
            {canRetry && (
              <DropdownMenuItem
                className="cursor-pointer"
                disabled={isRetrying}
                onClick={(e) => {
                  e.stopPropagation()
                  onRetry(delivery)
                }}
              >
                <RefreshIcon className="mr-2 size-4" />
                {isRetrying ? 'Retrying…' : 'Retry send'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  )
}
