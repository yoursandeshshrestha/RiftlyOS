import { Input } from '@/components/ui/input'
import { SearchIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { FinanceFilterCombobox, type FinanceFilterOption } from '@/components/finance/FinanceFilterCombobox'

export type { FinanceFilterOption }

interface FinanceTableToolbarProps {
  searchValue: string
  onSearchChange: (value: string) => void
  searchPlaceholder: string
  statusValue: string
  onStatusChange: (value: string) => void
  statusOptions: FinanceFilterOption[]
  typeValue?: string
  onTypeChange?: (value: string) => void
  typeOptions?: FinanceFilterOption[]
  onClear?: () => void
  hasActiveFilters?: boolean
}

export function FinanceTableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder,
  statusValue,
  onStatusChange,
  statusOptions,
  typeValue,
  onTypeChange,
  typeOptions,
  onClear,
  hasActiveFilters,
}: FinanceTableToolbarProps) {
  return (
    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
      <div className="relative w-full sm:w-auto sm:min-w-[220px]">
        <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          placeholder={searchPlaceholder}
          value={searchValue}
          onChange={(event) => onSearchChange(event.target.value)}
          className="h-9 w-full cursor-text rounded-md pl-8 text-[13px] sm:w-[240px]"
        />
      </div>

      <FinanceFilterCombobox
        value={statusValue}
        onValueChange={onStatusChange}
        options={statusOptions}
        placeholder="Status"
      />

      {typeOptions && onTypeChange ? (
        <FinanceFilterCombobox
          value={typeValue ?? 'all'}
          onValueChange={onTypeChange}
          options={typeOptions}
          placeholder="Type"
        />
      ) : null}

      {hasActiveFilters && onClear ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-9 cursor-pointer text-[13px]"
          onClick={onClear}
        >
          Clear
        </Button>
      ) : null}
    </div>
  )
}
