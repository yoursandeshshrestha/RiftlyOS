import { format, addMonths, subMonths } from 'date-fns'
import { Button } from '@/components/ui/button'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'
import { formatMonthYear } from '@/lib/date'

interface MonthSelectorProps {
  selectedMonth: Date
  onMonthChange: (date: Date) => void
}

export function MonthSelector({ selectedMonth, onMonthChange }: MonthSelectorProps) {
  const handlePrevMonth = () => {
    onMonthChange(subMonths(selectedMonth, 1))
  }

  const handleNextMonth = () => {
    onMonthChange(addMonths(selectedMonth, 1))
  }

  const handleToday = () => {
    onMonthChange(new Date())
  }

  const isCurrentMonth = format(selectedMonth, 'yyyy-MM') === format(new Date(), 'yyyy-MM')

  return (
    <div className="flex items-center justify-center gap-4">
      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        onClick={handlePrevMonth}
      >
        <ArrowLeftIcon className="size-4" />
      </Button>

      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold">
          {formatMonthYear(selectedMonth)}
        </h2>
        {!isCurrentMonth && (
          <Button
            variant="ghost"
            size="sm"
            className="cursor-pointer text-xs"
            onClick={handleToday}
          >
            Current Month
          </Button>
        )}
      </div>

      <Button
        variant="outline"
        size="sm"
        className="cursor-pointer"
        onClick={handleNextMonth}
      >
        <ArrowRightIcon className="size-4" />
      </Button>
    </div>
  )
}
