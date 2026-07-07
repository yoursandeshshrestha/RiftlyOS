import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { EuroIcon, AlertCircleIcon } from '@/components/icons'
import type { Deal } from '../types'

interface DealFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedDeal: Deal | null
  onSubmit: (data: {
    prospectName: string
    services: string
    dealValue: string
    nextAction: string
  }) => Promise<void>
  isCreating: boolean
  error: string
}

export function DealFormDialog({
  open,
  onOpenChange,
  selectedDeal,
  onSubmit,
  isCreating,
  error,
}: DealFormDialogProps) {
  const [formStep, setFormStep] = useState(1)
  const [prospectName, setProspectName] = useState('')
  const [services, setServices] = useState('')
  const [dealValue, setDealValue] = useState('')
  const [nextAction, setNextAction] = useState('')
  const [localError, setLocalError] = useState('')

  // Populate form when editing
  useEffect(() => {
    if (selectedDeal && open) {
      setProspectName(selectedDeal.prospect_name)
      setServices(selectedDeal.services)
      setDealValue(selectedDeal.deal_value.toString())
      setNextAction(selectedDeal.next_action || '')
    }
  }, [selectedDeal, open])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setFormStep(1)
      setProspectName('')
      setServices('')
      setDealValue('')
      setNextAction('')
      setLocalError('')
    }
  }, [open])

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault()
    if (formStep === 1 && prospectName && services) {
      setFormStep(2)
      setLocalError('')
    }
  }

  const handleBackStep = () => {
    setFormStep(1)
    setLocalError('')
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      prospectName,
      services,
      dealValue,
      nextAction,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>{selectedDeal ? 'Edit Deal' : 'Create New Deal'}</DialogTitle>
          <DialogDescription>
            Step {formStep} of 2: {formStep === 1 ? 'Basic Information' : 'Deal Details'}
          </DialogDescription>
        </DialogHeader>

        <form
          id="deal-form"
          onSubmit={formStep === 1 ? handleNextStep : handleSubmit}
          className="space-y-4"
        >
          {(error || localError) && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
              <p>{error || localError}</p>
            </div>
          )}

          {formStep === 1 ? (
            <>
              <div className="space-y-2">
                <Label htmlFor="prospect-name" className="cursor-pointer">
                  Prospect Name *
                </Label>
                <Input
                  id="prospect-name"
                  value={prospectName}
                  onChange={(e) => setProspectName(e.target.value)}
                  placeholder="e.g., Acme Corporation"
                  required
                  className="cursor-text"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="services" className="cursor-pointer">
                  Description *
                </Label>
                <Textarea
                  id="services"
                  value={services}
                  onChange={(e) => setServices(e.target.value)}
                  placeholder="Describe the services or project scope in detail..."
                  required
                  rows={6}
                  className="min-h-[120px] cursor-text resize-none py-2"
                />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="deal-value" className="cursor-pointer">
                  Deal Value *
                </Label>
                <div className="relative">
                  <EuroIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="deal-value"
                    type="number"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    placeholder="50000"
                    className="cursor-text pl-10"
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="next-action" className="cursor-pointer">
                  Next Action
                </Label>
                <Input
                  id="next-action"
                  value={nextAction}
                  onChange={(e) => setNextAction(e.target.value)}
                  placeholder="e.g., Schedule discovery call"
                  className="cursor-text"
                />
              </div>
            </>
          )}
        </form>

        <DialogFooter className="gap-2">
          <div className="flex w-full justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
              disabled={isCreating}
            >
              Cancel
            </Button>
            <div className="flex gap-2">
              {formStep === 2 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBackStep}
                  className="cursor-pointer"
                  disabled={isCreating}
                >
                  Back
                </Button>
              )}
              <Button
                type="submit"
                form="deal-form"
                className="cursor-pointer"
                loading={isCreating}
              >
                {isCreating
                  ? selectedDeal
                    ? 'Updating...'
                    : 'Creating...'
                  : formStep === 1
                    ? 'Next'
                    : selectedDeal
                      ? 'Update Deal'
                      : 'Create Deal'}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
