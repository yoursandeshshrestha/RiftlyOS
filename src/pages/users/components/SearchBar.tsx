import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'

interface SearchBarProps {
  value: string
  onChange: (value: string) => void
}

export function SearchBar({ value, onChange }: SearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        placeholder="Search users..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-9 w-[250px] cursor-text rounded-md pl-8 text-[13px]"
      />
    </div>
  )
}
