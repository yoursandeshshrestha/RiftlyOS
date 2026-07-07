import { useEffect, useMemo, useState } from 'react'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { formatMoney } from '@/lib/finance/money'
import type { RetainerListItem } from '@/lib/finance/subscriptions'
import { formatDate, formatDateRange, toDate } from '@/lib/date'
import { cn } from '@/lib/utils'
import { ClientBillingCell } from '@/components/finance/ClientBillingCell'
import { FinanceTableToolbar } from '@/components/finance/FinanceTableToolbar'
import { FinanceTablePagination } from '@/components/finance/FinanceTablePagination'
import {
  FINANCE_PAGE_SIZE,
  filterRetainers,
  getTotalPages,
  paginateItems,
} from '@/lib/finance/table-filters'
import { useFinanceListParams } from '@/lib/finance/use-finance-list-params'
import { updateRetainerBilling } from '@/lib/finance/retainer-actions'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/spinner'
import { MoreHorizontal } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'past_due', label: 'Past due' },
  { value: 'canceled', label: 'Canceled' },
  { value: 'trialing', label: 'Trialing' },
  { value: 'unpaid', label: 'Unpaid' },
]

interface RetainersTableProps {
  retainers: RetainerListItem[]
  isLoading: boolean
  workspaceId?: string
  onUpdated?: () => void | Promise<void>
}

export function RetainersTable({
  retainers,
  isLoading,
  workspaceId,
  onUpdated,
}: RetainersTableProps) {
  const { q, status, page, setSearch, setStatus, setPage } = useFinanceListParams('retainer')
  const [pendingAction, setPendingAction] = useState<{
    retainer: RetainerListItem
    action: 'pause' | 'resume'
  } | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)

  const filtered = useMemo(
    () => filterRetainers(retainers, { search: q, status }),
    [retainers, q, status],
  )

  const totalPages = getTotalPages(filtered.length)
  const safePage = Math.min(page, totalPages)
  const pageItems = paginateItems(filtered, safePage)

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, setPage, totalPages])

  const hasActiveFilters = Boolean(q) || status !== 'all'

  const handleConfirmAction = async () => {
    if (!pendingAction || !workspaceId) return

    setActingId(pendingAction.retainer.id)
    try {
      await updateRetainerBilling(
        pendingAction.retainer.id,
        workspaceId,
        pendingAction.action,
      )
      toast.success(
        pendingAction.action === 'pause'
          ? 'Retainer paused — billing will not run until resumed'
          : 'Retainer resumed — billing will continue on schedule',
      )
      setPendingAction(null)
      await onUpdated?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update retainer')
    } finally {
      setActingId(null)
    }
  }

  return (
    <>
      <Card variant="table">
        <CardEyebrow
          variant="table"
          title={`Retainers (${isLoading ? '…' : filtered.length})`}
          description="Monthly recurring subscriptions billed via Stripe"
          action={
            <FinanceTableToolbar
              searchValue={q}
              onSearchChange={setSearch}
              searchPlaceholder="Search retainers..."
              statusValue={status}
              onStatusChange={setStatus}
              statusOptions={STATUS_OPTIONS}
              hasActiveFilters={hasActiveFilters}
              onClear={() => {
                setSearch('')
                setStatus('all')
              }}
            />
          }
        />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">Client</TableHead>
              <TableHead className="text-[13px] font-medium">Description</TableHead>
              <TableHead className="text-[13px] font-medium">Monthly</TableHead>
              <TableHead className="text-[13px] font-medium">Billing day</TableHead>
              <TableHead className="text-[13px] font-medium">Status</TableHead>
              <TableHead className="text-[13px] font-medium">Current period</TableHead>
              <TableHead className="text-[13px] font-medium">Started</TableHead>
              <TableHead className="pr-6 text-right text-[13px] font-medium">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(3)].map((_, index) => (
                <TableRow key={index}>
                  {[...Array(8)].map((__, cellIndex) => (
                    <TableCell
                      key={cellIndex}
                      className={cellIndex === 0 ? 'pl-6' : cellIndex === 7 ? 'pr-6' : ''}
                    >
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : pageItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="py-10 text-center text-muted-foreground">
                  {hasActiveFilters
                    ? 'No retainers match your filters.'
                    : 'No retainers yet. Create one from Create Invoice → Retainer.'}
                </TableCell>
              </TableRow>
            ) : (
              pageItems.map((retainer) => (
                <TableRow key={retainer.id}>
                  <ClientBillingCell
                    className="pl-6"
                    clientName={retainer.clientName}
                    profileEmail={retainer.clientEmail}
                    billingEmail={retainer.billingEmail}
                  />
                  <TableCell className="max-w-[200px] truncate text-muted-foreground">
                    {retainer.description ?? 'Monthly retainer'}
                  </TableCell>
                  <TableCell className="font-medium">
                    {formatMoney(retainer.amount, retainer.currency)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatBillingDay(retainer)}
                  </TableCell>
                  <TableCell>
                    <SubscriptionStatusBadge
                      status={retainer.status}
                      billingPaused={retainer.billing_paused}
                    />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {retainer.current_period_start && retainer.current_period_end
                      ? formatDateRange(retainer.current_period_start, retainer.current_period_end)
                      : '—'}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(retainer.created_at)}
                  </TableCell>
                  <TableCell className="pr-6">
                    <RetainerActions
                      retainer={retainer}
                      isBusy={actingId === retainer.id}
                      onPause={() => setPendingAction({ retainer, action: 'pause' })}
                      onResume={() => setPendingAction({ retainer, action: 'resume' })}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>

        <FinanceTablePagination
          page={safePage}
          totalPages={totalPages}
          totalItems={filtered.length}
          pageSize={FINANCE_PAGE_SIZE}
          onPageChange={setPage}
        />
      </Card>

      <AlertDialog open={Boolean(pendingAction)} onOpenChange={(open) => !open && setPendingAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingAction?.action === 'pause' ? 'Pause retainer?' : 'Resume retainer?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingAction?.action === 'pause'
                ? 'Stripe will stop generating invoices for this retainer until you resume it. The client will not be billed while paused.'
                : 'Billing will continue on the normal schedule. Stripe may generate the next invoice according to the billing cycle.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">Cancel</AlertDialogCancel>
            <AlertDialogAction className="cursor-pointer" onClick={() => void handleConfirmAction()}>
              {pendingAction?.action === 'pause' ? 'Pause retainer' : 'Resume retainer'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function RetainerActions({
  retainer,
  isBusy,
  onPause,
  onResume,
}: {
  retainer: RetainerListItem
  isBusy: boolean
  onPause: () => void
  onResume: () => void
}) {
  const canManage =
    retainer.status !== 'canceled' && Boolean(retainer.provider_subscription_id)

  if (!canManage) {
    return <span className="block text-right text-muted-foreground">—</span>
  }

  if (isBusy) {
    return (
      <div className="flex justify-end">
        <Spinner size="xs" className="text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="flex justify-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer"
            aria-label="Retainer actions"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {retainer.billing_paused ? (
            <DropdownMenuItem className="cursor-pointer" onClick={onResume}>
              Resume billing
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem className="cursor-pointer" onClick={onPause}>
              Pause billing
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function formatBillingDay(retainer: RetainerListItem): string {
  const periodDate = toDate(retainer.current_period_start)
  if (periodDate) {
    return `Day ${periodDate.getDate()}`
  }

  const created = toDate(retainer.created_at)
  if (created) {
    return `Day ${created.getDate()}`
  }

  if (retainer.day_of_month) {
    return `Day ${retainer.day_of_month}`
  }

  return '—'
}

function SubscriptionStatusBadge({
  status,
  billingPaused,
}: {
  status: string
  billingPaused: boolean
}) {
  if (billingPaused) {
    return (
      <span className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
        Paused
      </span>
    )
  }

  const colorMap: Record<string, string> = {
    active: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    past_due: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    canceled: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    incomplete: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
    trialing: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    unpaid: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  }

  return (
    <span
      className={cn(
        'inline-block rounded px-2 py-0.5 text-xs font-medium capitalize',
        colorMap[status] ?? colorMap.incomplete,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
