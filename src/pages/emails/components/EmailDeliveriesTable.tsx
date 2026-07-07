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
import { FormCombobox } from '@/components/ui/form-combobox'
import { EmailDeliveriesTableRow } from './EmailDeliveriesTableRow'
import { EmailSearchBar } from './EmailSearchBar'
import type { EmailDelivery, EmailDeliveryStatus } from '../types'

type StatusFilter = 'all' | EmailDeliveryStatus

interface EmailDeliveriesTableProps {
  deliveries: EmailDelivery[]
  isLoading: boolean
  searchQuery: string
  onSearchChange: (value: string) => void
  statusFilter: StatusFilter
  onStatusFilterChange: (value: StatusFilter) => void
  retryingId: string | null
  onSelect: (delivery: EmailDelivery) => void
  onRetry: (delivery: EmailDelivery) => void
}

export function EmailDeliveriesTable({
  deliveries,
  isLoading,
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  retryingId,
  onSelect,
  onRetry,
}: EmailDeliveriesTableProps) {
  return (
    <Card variant="table">
      <CardEyebrow
        variant="table"
        title={`All Deliveries (${deliveries.length})`}
        action={
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <FormCombobox
              value={statusFilter}
              onValueChange={(value) => onStatusFilterChange(value as StatusFilter)}
              options={[
                { value: 'all', label: 'All statuses' },
                { value: 'sent', label: 'Sent' },
                { value: 'failed', label: 'Failed' },
                { value: 'pending', label: 'Pending' },
              ]}
              placeholder="Status"
              className="h-8 text-[13px] sm:w-[140px]"
            />
            <EmailSearchBar value={searchQuery} onChange={onSearchChange} />
          </div>
        }
      />
      <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">Recipient</TableHead>
              <TableHead className="text-[13px] font-medium">Template</TableHead>
              <TableHead className="text-[13px] font-medium">Subject</TableHead>
              <TableHead className="text-[13px] font-medium">Status</TableHead>
              <TableHead className="text-[13px] font-medium">Failure reason</TableHead>
              <TableHead className="text-[13px] font-medium">Queued</TableHead>
              <TableHead className="text-[13px] font-medium">Retries</TableHead>
              <TableHead className="pr-6 text-[13px] font-medium">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(6)].map((_, i) => (
                <TableRow key={i} className="cursor-pointer">
                  <TableCell className="pl-6 text-[13px]">
                    <Skeleton className="h-[13px] w-40" />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <Skeleton className="h-[13px] w-24" />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <Skeleton className="h-[13px] w-44" />
                  </TableCell>
                  <TableCell>
                    <Skeleton className="h-[18px] w-14 rounded-full" />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <Skeleton className="h-[13px] w-32" />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <Skeleton className="h-[13px] w-20" />
                  </TableCell>
                  <TableCell className="text-[13px]">
                    <Skeleton className="h-[13px] w-8" />
                  </TableCell>
                  <TableCell className="pr-6">
                    <Skeleton className="size-8 rounded-md" />
                  </TableCell>
                </TableRow>
              ))
            ) : deliveries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                  No email deliveries found.
                </TableCell>
              </TableRow>
            ) : (
              deliveries.map((delivery) => (
                <EmailDeliveriesTableRow
                  key={delivery.id}
                  delivery={delivery}
                  isRetrying={retryingId === delivery.id}
                  onSelect={onSelect}
                  onRetry={onRetry}
                />
              ))
            )}
          </TableBody>
        </Table>
    </Card>
  )
}
