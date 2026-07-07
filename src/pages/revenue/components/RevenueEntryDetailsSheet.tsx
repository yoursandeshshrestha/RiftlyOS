import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import type { RevenueBreakdownItem } from '../types'
import { formatDate } from '@/lib/date'

interface RevenueEntryDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  entry: RevenueBreakdownItem | null
  formatCurrency: (value: number) => string
}

const getSourceLabel = (source: RevenueBreakdownItem['source']) => {
  switch (source) {
    case 'service':
      return 'Service'
    case 'deal':
      return 'Deal'
    case 'manual':
      return 'Manual'
  }
}

export function RevenueEntryDetailsSheet({
  open,
  onOpenChange,
  entry,
  formatCurrency,
}: RevenueEntryDetailsSheetProps) {
  if (!entry) return null

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Revenue Entry Details</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6">
          <div className="divide-y">
            {/* Name */}
            <div className="py-4">
              <p className="mb-1.5 text-xs text-muted-foreground">Name</p>
              <p className="text-sm font-medium text-foreground">{entry.name}</p>
            </div>

            {/* Description */}
            {entry.description && (
              <div className="py-4">
                <p className="mb-1.5 text-xs text-muted-foreground">Description</p>
                <p className="text-sm text-foreground">{entry.description}</p>
              </div>
            )}

            {/* Amount */}
            <div className="py-4">
              <p className="mb-1.5 text-xs text-muted-foreground">Amount</p>
              <p className="text-sm font-medium text-foreground">{formatCurrency(entry.amount)}</p>
            </div>

            {/* Type */}
            <div className="py-4">
              <p className="mb-1.5 text-xs text-muted-foreground">Type</p>
              <p className="text-sm font-medium text-foreground capitalize">{getSourceLabel(entry.source)}</p>
            </div>

            {/* Date */}
            <div className="py-4">
              <p className="mb-1.5 text-xs text-muted-foreground">Date</p>
              <p className="text-sm font-medium text-foreground">{formatDate(entry.date)}</p>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
