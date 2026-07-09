import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
}

interface FormComboboxProps {
  value: string
  onValueChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  id?: string
  onOpenChange?: (open: boolean) => void
}

export function FormCombobox({
  value,
  onValueChange,
  options,
  placeholder = 'Select…',
  emptyText = 'No matches',
  className,
  disabled = false,
  id,
  onOpenChange,
}: FormComboboxProps) {
  const selected = options.find((option) => option.value === value) ?? null

  return (
    <Combobox
      items={options}
      value={selected}
      onValueChange={(item) => {
        if (item) onValueChange(item.value)
      }}
      onOpenChange={(open) => onOpenChange?.(open)}
      isItemEqualToValue={(a, b) => a.value === b.value}
      disabled={disabled}
    >
      <ComboboxInput
        id={id}
        placeholder={placeholder}
        showClear={false}
        disabled={disabled}
        className={cn('h-9 w-full cursor-pointer text-sm', className)}
      />
      <ComboboxContent>
        <ComboboxEmpty>{emptyText}</ComboboxEmpty>
        <ComboboxList>
          {(item: ComboboxOption) => (
            <ComboboxItem key={item.value} value={item} className="cursor-pointer text-sm">
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
