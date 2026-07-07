import { useEffect, useState, type ReactNode } from 'react'
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
import { SegmentedControl } from '@/components/ui/segmented-control'
import { supabase } from '@/lib/supabase'
import { getWorkspaceClients, type WorkspaceClient } from '@/lib/finance/clients'
import { formatMoney, toMinorUnits } from '@/lib/finance/money'
import { toast } from 'sonner'
import { FormCombobox } from '@/components/ui/form-combobox'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'

interface CreateInvoiceDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  onSuccess?: () => void
}

const INVOICE_TYPES = [
  { value: 'one_off', label: 'One-off' },
  { value: 'retainer', label: 'Retainer' },
] as const

const CURRENCIES = [
  { value: 'gbp', label: 'GBP' },
  { value: 'usd', label: 'USD' },
  { value: 'eur', label: 'EUR' },
] as const

const PAYMENT_TERMS = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
] as const

const STEPS = [
  {
    title: 'Invoice type',
    description: 'Choose whether this is a one-time invoice or a monthly retainer.',
  },
  {
    title: 'Client',
    description: 'Select who will receive this invoice and where to send it.',
  },
  {
    title: 'Amount',
    description: 'Describe the work and set how much to bill.',
  },
  {
    title: 'Billing',
    description: 'Set when payment is due or when the retainer bills each month.',
  },
] as const

function defaultBillingDay(): string {
  return String(Math.min(new Date().getDate(), 28))
}

const initialFormData = {
  clientUserId: '',
  description: '',
  amount: '',
  currency: 'gbp',
  billingEmail: '',
  daysUntilDue: '14',
  dayOfMonth: defaultBillingDay(),
}

function RequiredLabel({
  children,
  htmlFor,
}: {
  children: ReactNode
  htmlFor?: string
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      <span className="text-destructive" aria-hidden="true">
        {' '}
        *
      </span>
    </Label>
  )
}

function isValidAmount(value: string): boolean {
  const amount = parseFloat(value)
  return !Number.isNaN(amount) && amount > 0
}

function isValidBillingDay(value: string): boolean {
  const day = parseInt(value, 10)
  return !Number.isNaN(day) && day >= 1 && day <= 28
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  workspaceId,
  onSuccess,
}: CreateInvoiceDialogProps) {
  const [step, setStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [clients, setClients] = useState<WorkspaceClient[]>([])
  const [loadingClients, setLoadingClients] = useState(false)
  const [type, setType] = useState<'one_off' | 'retainer'>('one_off')
  const [formData, setFormData] = useState(initialFormData)

  const currentStep = STEPS[step]
  const isLastStep = step === STEPS.length - 1

  useEffect(() => {
    if (!open) {
      setStep(0)
      setType('one_off')
      setFormData(initialFormData)
      setIsLoading(false)
      return
    }

    if (!workspaceId) return

    const loadClients = async () => {
      setLoadingClients(true)
      try {
        const workspaceClients = await getWorkspaceClients(workspaceId)
        setClients(workspaceClients)
        const defaultClient = workspaceClients[0]
        setFormData({
          ...initialFormData,
          clientUserId: defaultClient?.id ?? '',
          billingEmail: defaultClient?.email ?? '',
        })
      } catch (error) {
        console.error('Failed to load clients:', error)
        toast.error('Failed to load clients')
        setClients([])
        setFormData(initialFormData)
      } finally {
        setLoadingClients(false)
      }
    }

    void loadClients()
  }, [open, workspaceId])

  const selectedClient = clients.find((client) => client.id === formData.clientUserId)

  const currencySymbol =
    formData.currency === 'gbp' ? '£' : formData.currency === 'usd' ? '$' : '€'

  const validateStep = (): string | null => {
    if (step === 1) {
      if (loadingClients) return 'Clients are still loading'
      if (clients.length === 0) return 'Add a client before creating an invoice'
      if (!formData.clientUserId) return 'Select a client to continue'
    }

    if (step === 2) {
      if (!formData.description.trim()) return 'Enter a description'
      if (!isValidAmount(formData.amount)) return 'Enter a valid amount'
    }

    if (step === 3 && type === 'retainer') {
      if (!isValidBillingDay(formData.dayOfMonth)) {
        return 'Billing day must be between 1 and 28'
      }
    }

    return null
  }

  const isStepValid = (): boolean => validateStep() === null

  const validateAll = (): string | null => {
    if (loadingClients) return 'Clients are still loading'
    if (clients.length === 0) return 'Add a client before creating an invoice'
    if (!formData.clientUserId) return 'Select a client to continue'
    if (!formData.description.trim()) return 'Enter a description'
    if (!isValidAmount(formData.amount)) return 'Enter a valid amount'
    if (type === 'retainer' && !isValidBillingDay(formData.dayOfMonth)) {
      return 'Billing day must be between 1 and 28'
    }
    return null
  }

  const isFormValid = validateAll() === null

  const handleNext = () => {
    const error = validateStep()
    if (error) {
      toast.error(error)
      return
    }
    setStep((current) => Math.min(current + 1, STEPS.length - 1))
  }

  const handleBack = () => {
    setStep((current) => Math.max(current - 1, 0))
  }

  const handleSubmit = async () => {
    const error = validateAll()
    if (error) {
      toast.error(error)
      return
    }

    setIsLoading(true)

    try {
      const amount = parseFloat(formData.amount)
      if (!workspaceId) {
        toast.error('No workspace selected')
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        toast.error('Not authenticated')
        return
      }

      const response = await supabase.functions.invoke('create-invoice', {
        body: {
          workspaceId,
          clientUserId: formData.clientUserId,
          type,
          currency: formData.currency,
          amount: toMinorUnits(amount, formData.currency),
          description: formData.description,
          billingEmail: formData.billingEmail || undefined,
          daysUntilDue: parseInt(formData.daysUntilDue),
          dayOfMonth: formData.dayOfMonth
            ? parseInt(formData.dayOfMonth, 10)
            : Math.min(new Date().getDate(), 28),
        },
      })

      if (response.error) {
        let errorMsg = 'Failed to create invoice'

        if (response.error.context && response.error.context instanceof Response) {
          try {
            const errorBody = await response.error.context.json()
            errorMsg = errorBody.error || errorMsg
          } catch {
            // use default message
          }
        }

        throw new Error(errorMsg)
      }

      if (response.data?.error) {
        throw new Error(response.data.error)
      }

      toast.success(
        type === 'one_off'
          ? 'Invoice created — sending to client'
          : 'Retainer created — sending first invoice',
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>Create Invoice</DialogTitle>
          <DialogDescription>{currentStep.description}</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          {STEPS.map((item, index) => (
            <div
              key={item.title}
              className={cn(
                'h-1 flex-1 rounded-md transition-colors',
                index <= step ? 'bg-foreground' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <p className="text-[12px] text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {currentStep.title}
        </p>

        <div className="min-h-[220px] space-y-4 py-2">
          {step === 0 ? (
            <div className="space-y-2">
              <Label>Invoice type</Label>
              <SegmentedControl
                value={type}
                onValueChange={(value) => setType(value as 'one_off' | 'retainer')}
                options={INVOICE_TYPES}
                aria-label="Invoice type"
              />
              <p className="text-xs text-muted-foreground">
                {type === 'one_off'
                  ? 'A single invoice for completed work or a one-time charge.'
                  : 'A recurring monthly subscription billed through Stripe.'}
              </p>
            </div>
          ) : null}

          {step === 1 ? (
            <>
              <div className="space-y-2">
                <RequiredLabel>Client</RequiredLabel>
                {loadingClients ? (
                  <p className="text-sm text-muted-foreground">Loading clients...</p>
                ) : clients.length === 0 ? (
                  <div className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
                    No clients in this workspace yet.{' '}
                    <Link to="/users" className="text-primary hover:underline">
                      Add a client in Users
                    </Link>
                  </div>
                ) : (
                  <FormCombobox
                    value={formData.clientUserId}
                    onValueChange={(clientUserId) => {
                      const client = clients.find((item) => item.id === clientUserId)
                      setFormData({
                        ...formData,
                        clientUserId,
                        billingEmail: client?.email ?? formData.billingEmail,
                      })
                    }}
                    options={clients.map((client) => ({
                      value: client.id,
                      label: `${client.fullName} (${client.email})`,
                    }))}
                    placeholder="Select a client"
                  />
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="billingEmail">Bill to email</Label>
                <Input
                  id="billingEmail"
                  type="email"
                  placeholder="client@company.com"
                  value={formData.billingEmail}
                  onChange={(e) =>
                    setFormData({ ...formData, billingEmail: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Defaults to the selected client&apos;s email.
                </p>
              </div>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <div className="space-y-2">
                <RequiredLabel htmlFor="description">Description</RequiredLabel>
                <Textarea
                  id="description"
                  placeholder="e.g. Web development services for Q1"
                  rows={3}
                  className="resize-none"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData({ ...formData, description: e.target.value })
                  }
                />
              </div>

              <div className="space-y-2">
                <RequiredLabel htmlFor="amount">Amount</RequiredLabel>
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
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Currency</Label>
                <SegmentedControl
                  value={formData.currency}
                  onValueChange={(currency) => setFormData({ ...formData, currency })}
                  options={CURRENCIES}
                  aria-label="Currency"
                />
              </div>
            </>
          ) : null}

          {step === 3 ? (
            <>
              {type === 'one_off' ? (
                <div className="space-y-2">
                  <Label>Payment terms</Label>
                  <SegmentedControl
                    value={formData.daysUntilDue}
                    onValueChange={(daysUntilDue) =>
                      setFormData({ ...formData, daysUntilDue })
                    }
                    options={PAYMENT_TERMS}
                    aria-label="Payment terms"
                  />
                  <p className="text-xs text-muted-foreground">
                    Invoice due {formData.daysUntilDue} days after issue.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <RequiredLabel htmlFor="dayOfMonth">Billing day</RequiredLabel>
                  <Input
                    id="dayOfMonth"
                    type="number"
                    min="1"
                    max="28"
                    placeholder="e.g. 8"
                    value={formData.dayOfMonth}
                    onChange={(e) =>
                      setFormData({ ...formData, dayOfMonth: e.target.value })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Day of the month Stripe bills this retainer (1–28).
                  </p>
                </div>
              )}

              <div className="rounded-md border border-border-table bg-sidebar/50 p-3 text-[13px]">
                <p className="font-medium">Summary</p>
                <dl className="mt-2 space-y-1.5 text-muted-foreground">
                  <div className="flex justify-between gap-3">
                    <dt>Type</dt>
                    <dd className="text-foreground">{type === 'one_off' ? 'One-off' : 'Retainer'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Client</dt>
                    <dd className="truncate text-foreground">{selectedClient?.fullName ?? '—'}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>Amount</dt>
                    <dd className="text-foreground">
                      {formData.amount && !Number.isNaN(parseFloat(formData.amount))
                        ? formatMoney(
                            toMinorUnits(parseFloat(formData.amount), formData.currency),
                            formData.currency,
                          )
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt>{type === 'one_off' ? 'Due' : 'Billing day'}</dt>
                    <dd className="text-foreground">
                      {type === 'one_off'
                        ? `${formData.daysUntilDue} days`
                        : `Day ${formData.dayOfMonth}`}
                    </dd>
                  </div>
                </dl>
              </div>
            </>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
            className="cursor-pointer"
          >
            Cancel
          </Button>

          <div className="flex gap-2">
            {step > 0 ? (
              <Button
                type="button"
                variant="outline"
                onClick={handleBack}
                disabled={isLoading}
                className="cursor-pointer"
              >
                Back
              </Button>
            ) : null}

            {isLastStep ? (
              <Button
                type="button"
                loading={isLoading}
                disabled={!isFormValid}
                className="cursor-pointer"
                onClick={() => void handleSubmit()}
              >
                {type === 'one_off' ? 'Create Invoice' : 'Create Retainer'}
              </Button>
            ) : (
              <Button
                type="button"
                onClick={handleNext}
                disabled={!isStepValid()}
                className="cursor-pointer"
              >
                Continue
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
