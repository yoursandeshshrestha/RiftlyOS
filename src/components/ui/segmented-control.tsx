import { cn } from '@/lib/utils'

export interface SegmentedControlOption {
  value: string
  label: string
}

interface SegmentedControlProps {
  value: string
  onValueChange: (value: string) => void
  options: readonly SegmentedControlOption[]
  className?: string
  disabled?: boolean
  'aria-label'?: string
}

const columnClass: Record<number, string> = {
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
}

export function SegmentedControl({
  value,
  onValueChange,
  options,
  className,
  disabled = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps) {
  const columns = columnClass[options.length] ?? 'grid-cols-2'

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn(
        'grid gap-1 rounded-md border border-border dark:border-border-subtle bg-popover p-1',
        columns,
        disabled && 'pointer-events-none opacity-50',
        className,
      )}
    >
      {options.map((option) => {
        const isSelected = value === option.value

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={() => onValueChange(option.value)}
            className={cn(
              'h-9 cursor-pointer rounded-md px-3 text-[13px] transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
              isSelected
                ? 'bg-sidebar font-medium text-foreground'
                : 'font-normal text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
