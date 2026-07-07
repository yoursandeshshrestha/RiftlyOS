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

interface SetTargetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentTarget?: number
  onSave: (amount: number) => Promise<void>
}

export function SetTargetDialog({
  open,
  onOpenChange,
  currentTarget,
  onSave,
}: SetTargetDialogProps) {
  const [amount, setAmount] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setAmount(currentTarget ? currentTarget.toString() : '')
      setError('')
    }
  }, [open, currentTarget])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount < 0) {
      setError('Please enter a valid amount')
      return
    }

    setIsSaving(true)
    try {
      await onSave(numAmount)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save target')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Set Monthly Revenue Target</DialogTitle>
          <DialogDescription>
            Set your revenue goal for this month. This will be used to track progress.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="target-amount">Target Amount *</Label>
              <Input
                id="target-amount"
                type="number"
                placeholder="50000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                step="0.01"
                min="0"
                required
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" loading={isSaving} className="cursor-pointer">
              {isSaving ? 'Saving...' : 'Save Target'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
