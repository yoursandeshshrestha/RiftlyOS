import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { supabase } from '@/lib/supabase'
import { toMinorUnits } from '@/lib/finance/money'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface CreateInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onSuccess?: () => void
}

const CURRENCIES = [
  { value: 'gbp', label: 'GBP (£)' },
  { value: 'usd', label: 'USD ($)' },
  { value: 'eur', label: 'EUR (€)' },
] as const

const PAYMENT_TERMS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const

const initialFormData = {
  description: '',
  amount: '',
  currency: 'gbp',
  daysUntilDue: '14',
  dayOfMonth: '',
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
}: CreateInvoiceDialogProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [type, setType] = useState<'one_off' | 'retainer'>('one_off')
  const [formData, setFormData] = useState(initialFormData)

  useEffect(() => {
    if (!open) {
      setType('one_off')
      setFormData(initialFormData)
      setIsLoading(false)
    }
  }, [open])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const amount = parseFloat(formData.amount)
      if (isNaN(amount) || amount <= 0) {
        toast.error('Please enter a valid amount')
        setIsLoading(false)
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toast.error('Not authenticated')
        setIsLoading(false)
        return
      }

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-invoice`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            workspaceId,
            type,
            currency: formData.currency,
            amount: toMinorUnits(amount, formData.currency),
            description: formData.description,
            daysUntilDue: parseInt(formData.daysUntilDue),
            dayOfMonth: formData.dayOfMonth ? parseInt(formData.dayOfMonth) : undefined,
          }),
        }
      )

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create invoice')
      }

      toast.success(
        type === 'one_off' ? 'Invoice created successfully' : 'Retainer created successfully'
      )
      onOpenChange(false)
      onSuccess?.()
    } catch (error) {
      console.error('Failed to create invoice:', error)
      toast.error(error instanceof Error ? error.message : 'Failed to create invoice')
    } finally {
      setIsLoading(false)
    }
  }

  const currencySymbol =
    formData.currency === 'gbp' ? '£' : formData.currency === 'usd' ? '$' : '€'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-0">
        <DialogHeader>
          <DialogTitle>Create Invoice</DialogTitle>
          <DialogDescription>
            {type === 'one_off'
              ? 'Send a one-time invoice for completed work or services.'
              : 'Set up a recurring monthly retainer subscription.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit}>
          <div className="space-y-4 py-4">
            <Tabs
              value={type}
              onValueChange={(value) => setType(value as 'one_off' | 'retainer')}
              className="w-full"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="one_off" className="cursor-pointer">
                  One-off
                </TabsTrigger>
                <TabsTrigger value="retainer" className="cursor-pointer">
                  Retainer
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="e.g. Web development services for Q1"
                rows={3}
                className="resize-none"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                required
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="amount">Amount</Label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                    {currencySymbol}
                  </span>
                  <Input
                    id="amount"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    className="pl-8"
                    value={formData.amount}
                    onChange={(e) =>
                      setFormData({ ...formData, amount: e.target.value })
                    }
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <div className="grid grid-cols-3 gap-2">
                  {CURRENCIES.map((currency) => (
                    <button
                      key={currency.value}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, currency: currency.value })
                      }
                      className={cn(
                        'rounded-md border px-3 py-2 text-sm font-medium transition-all cursor-pointer',
                        formData.currency === currency.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      {currency.value.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {type === 'one_off' ? (
              <div className="space-y-2">
                <Label>Payment terms</Label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_TERMS.map((term) => (
                    <button
                      key={term.value}
                      type="button"
                      onClick={() =>
                        setFormData({ ...formData, daysUntilDue: term.value })
                      }
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-sm font-medium transition-all cursor-pointer',
                        formData.daysUntilDue === term.value
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-primary/50'
                      )}
                    >
                      {term.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">
                  Invoice due {formData.daysUntilDue} days after issue
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="dayOfMonth">Billing day</Label>
                <Input
                  id="dayOfMonth"
                  type="number"
                  min="1"
                  max="28"
                  placeholder="Same day each month (optional)"
                  value={formData.dayOfMonth}
                  onChange={(e) =>
                    setFormData({ ...formData, dayOfMonth: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Leave blank to start billing today.
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isLoading}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button type="submit" loading={isLoading} className="cursor-pointer">
              {type === 'one_off' ? 'Create Invoice' : 'Create Retainer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
