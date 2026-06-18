import { Input } from '@/components/ui/input'
import { SearchIcon } from '@/components/icons'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative w-full sm:w-auto">
      <SearchIcon className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search users..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-full cursor-text rounded-md pl-8 text-[13px] sm:w-[250px]"
      />
    </div>
  )
}
