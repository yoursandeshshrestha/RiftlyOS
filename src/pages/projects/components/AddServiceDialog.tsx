import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CalendarIcon } from '@/components/icons'

interface AddServiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (service: {
    name: string
    mrr: string
    startDate: string
    renewalDate: string
  }) => Promise<void>
  isSaving: boolean
  error: string
}

export function AddServiceDialog({
  open,
  onOpenChange,
  onSubmit,
  isSaving,
  error,
}: AddServiceDialogProps) {
  const [name, setName] = useState('')
  const [mrr, setMrr] = useState('')
  const [startDate, setStartDate] = useState('')
  const [renewalDate, setRenewalDate] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    await onSubmit({
      name,
      mrr,
      startDate,
      renewalDate,
    })

    // Reset form
    setName('')
    setMrr('')
    setStartDate('')
    setRenewalDate('')
  }

  const handleCancel = () => {
    setName('')
    setMrr('')
    setStartDate('')
    setRenewalDate('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="service-name">Service Name</Label>
            <Input
              id="service-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Website Hosting"
              required
              className="cursor-text"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mrr">Monthly Recurring Revenue (MRR)</Label>
            <Input
              id="mrr"
              type="number"
              step="0.01"
              value={mrr}
              onChange={(e) => setMrr(e.target.value)}
              placeholder="0.00"
              required
              className="cursor-text"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="start-date">Start Date</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  required
                  className="cursor-text pl-10"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="renewal-date">Renewal Date</Label>
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="renewal-date"
                  type="date"
                  value={renewalDate}
                  onChange={(e) => setRenewalDate(e.target.value)}
                  required
                  className="cursor-text pl-10"
                />
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving} className="cursor-pointer">
              {isSaving ? 'Adding...' : 'Add Service'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
