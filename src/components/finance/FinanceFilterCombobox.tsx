import { FormCombobox, type ComboboxOption } from '@/components/ui/form-combobox'
import { cn } from '@/lib/utils'

export type FinanceFilterOption = ComboboxOption

interface FinanceFilterComboboxProps {
  value: string
  onValueChange: (value: string) => void
  options: FinanceFilterOption[]
  placeholder: string
  className?: string
}

export function FinanceFilterCombobox({
  value,
  onValueChange,
  options,
  placeholder,
  className,
}: FinanceFilterComboboxProps) {
  return (
    <FormCombobox
      value={value}
      onValueChange={onValueChange}
      options={options}
      placeholder={placeholder}
      className={cn('text-[13px] sm:w-[160px]', className)}
    />
  )
}
