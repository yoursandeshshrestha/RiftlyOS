import { Badge } from '@/components/ui/badge'
import type { Deal } from '../types'

interface DealCardProps {
  deal: Deal
  onDragStart: (deal: Deal) => void
  onClick: (deal: Deal) => void
  formatCurrency: (value: number) => string
}

export function DealCard({ deal, onDragStart, onClick, formatCurrency }: DealCardProps) {
  return (
    <div
      draggable
      onDragStart={() => onDragStart(deal)}
      onClick={() => onClick(deal)}
      className="surface-card cursor-pointer rounded-md"
    >
      <div className="flex min-h-[140px] flex-col space-y-2">
        {/* Prospect Name */}
        <h4 className="text-sm font-medium leading-tight text-foreground dark:text-gray-100">
          {deal.prospect_name}
        </h4>

        {/* Services */}
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground dark:text-gray-300">
          {deal.services}
        </p>

        {/* Next Action */}
        {deal.next_action && (
          <p className="line-clamp-1 text-xs text-muted-foreground dark:text-gray-400">
            → {deal.next_action}
          </p>
        )}

        {/* Deal Value Badge */}
        <div className="mt-auto pt-1">
          <Badge variant="secondary" className="text-xs font-medium">
            {formatCurrency(Number(deal.deal_value))}
          </Badge>
        </div>
      </div>
    </div>
  )
}
