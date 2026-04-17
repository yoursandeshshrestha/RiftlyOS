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
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-lg">
        {/* Fixed Header */}
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle>{selectedDeal ? 'Edit Deal' : 'Create New Deal'}</DialogTitle>
          <DialogDescription>
            Step {formStep} of 2: {formStep === 1 ? 'Basic Information' : 'Deal Details'}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Content */}
        <form onSubmit={formStep === 1 ? handleNextStep : handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {(error || localError) && (
              <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                <p>{error || localError}</p>
              </div>
            )}

            {formStep === 1 ? (
              <>
                <div className="space-y-2">
                  <Label htmlFor="prospect-name" className="text-sm font-medium cursor-pointer">
                    Prospect Name *
                  </Label>
                  <Input
                    id="prospect-name"
                    value={prospectName}
                    onChange={(e) => setProspectName(e.target.value)}
                    placeholder="e.g., Acme Corporation"
                    required
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="services" className="text-sm font-medium cursor-pointer">
                    Description *
                  </Label>
                  <Textarea
                    id="services"
                    value={services}
                    onChange={(e) => setServices(e.target.value)}
                    placeholder="Describe the services or project scope in detail..."
                    required
                    rows={8}
                    className="resize-none"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="deal-value" className="text-sm font-medium cursor-pointer">
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
                      className="pl-10"
                      required
                      min="0"
                      step="0.01"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="next-action" className="text-sm font-medium cursor-pointer">
                    Next Action
                  </Label>
                  <Input
                    id="next-action"
                    value={nextAction}
                    onChange={(e) => setNextAction(e.target.value)}
                    placeholder="e.g., Schedule discovery call"
                  />
                </div>
              </>
            )}
          </div>

          {/* Fixed Footer */}
          <DialogFooter className="border-t border-border/50 px-6 py-4">
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
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="cursor-pointer"
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="cursor-pointer"
              disabled={isCreating}
            >
              {isCreating ? (
                <span className="flex items-center gap-2">
                  <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                  {selectedDeal ? 'Updating...' : 'Creating...'}
                </span>
              ) : formStep === 1 ? (
                'Next'
              ) : (
                selectedDeal ? 'Update Deal' : 'Create Deal'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
