import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FormCombobox } from '@/components/ui/form-combobox'
import { CalendarIcon } from '@/components/icons'
import { REVENUE_CATEGORIES } from '../types'
import { formatDate, toISODateString } from '@/lib/date'

interface AddEntryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (data: {
    amount: string
    description: string
    date: string
    category: 'service_income' | 'project_income' | 'other'
  }) => Promise<void>
}

export function AddEntryDialog({ open, onOpenChange, onSave }: AddEntryDialogProps) {
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState<Date>(new Date())
  const [category, setCategory] = useState<'service_income' | 'project_income' | 'other'>('other')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setAmount('')
      setDescription('')
      setDate(new Date())
      setCategory('other')
      setError('')
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) {
      setError('Please enter a valid amount')
      return
    }

    if (!description.trim()) {
      setError('Please enter a description')
      return
    }

    setIsSaving(true)
    try {
      await onSave({ amount, description, date: toISODateString(date), category })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add entry')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>Add Manual Revenue Entry</DialogTitle>
          <DialogDescription>
            Record revenue that&apos;s not tracked in deals or services.
          </DialogDescription>
        </DialogHeader>

        <form id="revenue-entry-form" onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="amount">Amount *</Label>
            <Input
              id="amount"
              type="number"
              placeholder="5000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              step="0.01"
              min="0"
              required
              className="cursor-text"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description *</Label>
            <Textarea
              id="description"
              placeholder="Describe this revenue source..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              required
              className="min-h-[80px] cursor-text resize-none py-2"
            />
          </div>

          <div className="space-y-2">
            <Label>Date *</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full cursor-pointer justify-start text-left font-normal"
                >
                  <CalendarIcon className="mr-2 size-4" />
                  {formatDate(date)}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(newDate) => newDate && setDate(newDate)}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category *</Label>
            <FormCombobox
              id="category"
              value={category}
              onValueChange={(value) => setCategory(value as typeof category)}
              options={REVENUE_CATEGORIES.map((cat) => ({ value: cat.id, label: cat.label }))}
              placeholder="Select category..."
            />
          </div>
        </form>

        <DialogFooter className="gap-2">
          <div className="flex w-full justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="revenue-entry-form"
              loading={isSaving}
              className="cursor-pointer"
            >
              {isSaving ? 'Adding...' : 'Add Entry'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
