import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'

interface FinanceTablePaginationProps {
  page: number
  totalPages: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
}

export function FinanceTablePagination({
  page,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
}: FinanceTablePaginationProps) {
  if (totalItems === 0) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, totalItems)

  return (
    <div className="flex flex-col gap-2 border-t border-border-table px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-[12px] text-muted-foreground">
        Showing {start}–{end} of {totalItems}
        {totalPages > 1 ? ` · Page ${page} of ${totalPages}` : ''}
      </p>

      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            className="h-8 w-8 cursor-pointer p-0"
            aria-label="Previous page"
          >
            <ArrowLeftIcon className="size-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            className="h-8 w-8 cursor-pointer p-0"
            aria-label="Next page"
          >
            <ArrowRightIcon className="size-4" />
          </Button>
        </div>
      ) : null}
    </div>
  )
}
