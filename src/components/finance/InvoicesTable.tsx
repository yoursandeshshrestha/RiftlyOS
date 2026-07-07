import { useEffect, useMemo } from 'react'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/finance/money'
import type { InvoiceListItem } from '@/lib/finance/invoices'
import { formatDate, formatDateTime } from '@/lib/date'
import { DownloadIcon, ExternalLinkIcon } from '@/components/icons'
import { cn } from '@/lib/utils'
import { ClientBillingCell } from '@/components/finance/ClientBillingCell'
import { FinanceTableToolbar } from '@/components/finance/FinanceTableToolbar'
import { FinanceTablePagination } from '@/components/finance/FinanceTablePagination'
import {
  FINANCE_PAGE_SIZE,
  filterInvoices,
  getTotalPages,
  paginateItems,
} from '@/lib/finance/table-filters'
import { useFinanceListParams } from '@/lib/finance/use-finance-list-params'

const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'paid', label: 'Paid' },
  { value: 'open', label: 'Open' },
  { value: 'past_due', label: 'Past due' },
  { value: 'draft', label: 'Draft' },
  { value: 'void', label: 'Void' },
  { value: 'uncollectible', label: 'Uncollectible' },
]

const TYPE_OPTIONS = [
  { value: 'all', label: 'All types' },
  { value: 'one_off', label: 'One-off' },
  { value: 'retainer', label: 'Retainer' },
]

interface InvoicesTableProps {
  invoices: InvoiceListItem[]
  isLoading: boolean
}

export function InvoicesTable({ invoices, isLoading }: InvoicesTableProps) {
  const { q, status, type, page, setSearch, setStatus, setType, setPage } =
    useFinanceListParams('invoice')

  const filtered = useMemo(
    () => filterInvoices(invoices, { search: q, status, type }),
    [invoices, q, status, type],
  )

  const totalPages = getTotalPages(filtered.length)
  const safePage = Math.min(page, totalPages)
  const pageItems = paginateItems(filtered, safePage)

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages)
    }
  }, [page, setPage, totalPages])

  const hasActiveFilters = Boolean(q) || status !== 'all' || type !== 'all'

  return (
    <Card variant="table">
      <CardEyebrow
        variant="table"
        title={`Invoices (${isLoading ? '…' : filtered.length})`}
        description="All invoices sent from this workspace"
        action={
          <FinanceTableToolbar
            searchValue={q}
            onSearchChange={setSearch}
            searchPlaceholder="Search invoices..."
            statusValue={status}
            onStatusChange={setStatus}
            statusOptions={STATUS_OPTIONS}
            typeValue={type}
            onTypeChange={setType}
            typeOptions={TYPE_OPTIONS}
            hasActiveFilters={hasActiveFilters}
            onClear={() => {
              setSearch('')
              setStatus('all')
              setType('all')
            }}
          />
        }
      />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-6 text-[13px] font-medium">Client</TableHead>
            <TableHead className="text-[13px] font-medium">Description</TableHead>
            <TableHead className="text-[13px] font-medium">Type</TableHead>
            <TableHead className="text-[13px] font-medium">Status</TableHead>
            <TableHead className="text-[13px] font-medium">Total</TableHead>
            <TableHead className="text-[13px] font-medium">Paid</TableHead>
            <TableHead className="text-[13px] font-medium">Due</TableHead>
            <TableHead className="text-[13px] font-medium">Issued</TableHead>
            <TableHead className="pr-6 text-right text-[13px] font-medium">Links</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            [...Array(4)].map((_, index) => (
              <TableRow key={index}>
                {[...Array(9)].map((__, cellIndex) => (
                  <TableCell
                    key={cellIndex}
                    className={cellIndex === 0 ? 'pl-6' : cellIndex === 8 ? 'pr-6' : ''}
                  >
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : pageItems.length === 0 ? (
            <TableRow>
              <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                {hasActiveFilters
                  ? 'No invoices match your filters.'
                  : 'No invoices yet. Create one to get started.'}
              </TableCell>
            </TableRow>
          ) : (
            pageItems.map((invoice) => (
              <TableRow key={invoice.id}>
                <ClientBillingCell
                  className="pl-6"
                  clientName={invoice.clientName}
                  profileEmail={invoice.clientEmail}
                  billingEmail={invoice.billingEmail}
                />
                <TableCell className="max-w-[200px] truncate text-muted-foreground">
                  {invoice.description ?? '—'}
                </TableCell>
                <TableCell className="capitalize">
                  {invoice.type.replace('_', ' ')}
                </TableCell>
                <TableCell>
                  <StatusBadge status={invoice.status} />
                </TableCell>
                <TableCell className="font-medium">
                  {formatMoney(invoice.total, invoice.currency)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatMoney(invoice.amount_paid, invoice.currency)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDate(invoice.due_date)}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(invoice.issued_at)}
                </TableCell>
                <TableCell className="pr-6">
                  <div className="flex items-center justify-end">
                    {invoice.hosted_url || invoice.pdf_url ? (
                      <ButtonGroup>
                        {invoice.hosted_url ? (
                          <Button variant="outline" size="xs" asChild>
                            <a
                              href={invoice.hosted_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <ExternalLinkIcon className="size-3" />
                              View
                            </a>
                          </Button>
                        ) : null}
                        {invoice.pdf_url ? (
                          <Button variant="outline" size="xs" asChild>
                            <a
                              href={invoice.pdf_url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <DownloadIcon className="size-3" />
                              PDF
                            </a>
                          </Button>
                        ) : null}
                      </ButtonGroup>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
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
  )
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    past_due: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    void: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
    uncollectible: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400',
  }

  return (
    <span
      className={cn(
        'inline-block rounded px-2 py-0.5 text-xs font-medium capitalize',
        colorMap[status] ?? colorMap.draft,
      )}
    >
      {status.replace('_', ' ')}
    </span>
  )
}
