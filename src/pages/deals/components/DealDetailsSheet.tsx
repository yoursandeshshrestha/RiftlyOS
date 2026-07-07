import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import type { Deal } from '../types'
import { STAGES } from '../types'
import { formatDateTime } from '@/lib/date'

interface DealDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  deal: Deal | null
  onEdit: () => void
  onDelete: () => void
  formatCurrency: (value: number) => string
}

export function DealDetailsSheet({
  open,
  onOpenChange,
  deal,
  onEdit,
  onDelete,
  formatCurrency,
}: DealDetailsSheetProps) {
  if (!deal) return null

  const getStageName = (stage: string) => {
    return STAGES.find(s => s.id === stage)?.label || stage
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{deal.prospect_name}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6">
          {/* Deal Value */}
          <div className="rounded-md bg-muted p-3">
            <p className="text-xs text-muted-foreground dark:text-gray-400">Deal Value</p>
            <p className="mt-1 text-xl font-semibold dark:text-gray-100">
              {formatCurrency(Number(deal.deal_value))}
            </p>
          </div>

          {/* Next Action */}
          {deal.next_action && (
            <div className="rounded-md bg-muted p-4">
              <p className="text-xs font-medium text-muted-foreground dark:text-gray-400">Next Action</p>
              <p className="mt-1 text-sm text-foreground dark:text-gray-100">
                {deal.next_action}
              </p>
            </div>
          )}

          {/* Summary */}
          <div className="space-y-2">
            <p className="text-sm leading-relaxed text-muted-foreground dark:text-gray-300">
              Deal is in <span className="font-semibold text-foreground dark:text-gray-100">{getStageName(deal.stage)}</span> stage,
              was created on <span className="font-semibold text-foreground dark:text-gray-100">{formatDateTime(deal.created_at)}</span>,
              and interested in <span className="font-semibold text-foreground dark:text-gray-100">{deal.services}</span>.
            </p>
          </div>
        </div>

        <SheetFooter className="flex-row gap-3">
          <Button variant="outline" className="flex-1 cursor-pointer" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="destructive" className="flex-1 cursor-pointer" onClick={onDelete}>
            Delete
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
