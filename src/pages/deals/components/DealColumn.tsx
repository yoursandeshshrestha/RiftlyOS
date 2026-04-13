import { DealCard } from './DealCard'
import type { Deal } from '../types'

interface DealColumnProps {
  stage: {
    id: string
    label: string
  }
  deals: Deal[]
  isLoading: boolean
  totalValue: number
  onDragOver: (e: React.DragEvent) => void
  onDrop: () => void
  onDragStart: (deal: Deal) => void
  onCardClick: (deal: Deal) => void
  formatCurrency: (value: number) => string
}

export function DealColumn({
  stage,
  deals,
  isLoading,
  totalValue,
  onDragOver,
  onDrop,
  onDragStart,
  onCardClick,
  formatCurrency,
}: DealColumnProps) {
  return (
    <div
      className="flex w-[380px] shrink-0 flex-col rounded-xl border bg-muted/50 p-3"
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {/* Column Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground dark:text-gray-100">
          {stage.label} ({deals.length})
        </h3>
        <span className="text-xs text-muted-foreground dark:text-gray-400">
          {formatCurrency(totalValue)}
        </span>
      </div>

      {/* Cards Container */}
      <div className="flex min-h-[160px] flex-col gap-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <div className="inline-block size-6 animate-spin rounded-full border-2 border-solid border-current border-r-transparent" />
          </div>
        ) : deals.length === 0 ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground dark:text-gray-400">
            No deals
          </div>
        ) : (
          deals.map((deal) => (
            <DealCard
              key={deal.id}
              deal={deal}
              onDragStart={onDragStart}
              onClick={onCardClick}
              formatCurrency={formatCurrency}
            />
          ))
        )}
      </div>
    </div>
  )
}
