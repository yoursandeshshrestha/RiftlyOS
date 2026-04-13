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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AlertCircle, Plus, Trash2 } from 'lucide-react'
import type { Project } from '../types'
import { PROJECT_STATUSES } from '../types'

interface Service {
  id?: string
  name: string
  mrr: string
  startDate: string
  renewalDate: string
}

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedProject: Project | null
  onSubmit: (data: {
    name: string
    clientName: string
    status: 'active' | 'paused' | 'completed'
    flags: string
    services: Service[]
  }) => Promise<void>
  isSaving: boolean
  error: string
}

export function ProjectFormDialog({
  open,
  onOpenChange,
  selectedProject,
  onSubmit,
  isSaving,
  error,
}: ProjectFormDialogProps) {
  const [formStep, setFormStep] = useState(1)
  const [name, setName] = useState('')
  const [clientName, setClientName] = useState('')
  const [status, setStatus] = useState<'active' | 'paused' | 'completed'>('active')
  const [flags, setFlags] = useState('')
  const [services, setServices] = useState<Service[]>([])

  // Populate form when editing
  useEffect(() => {
    if (selectedProject && open) {
      setName(selectedProject.name)
      setClientName(selectedProject.client_name)
      setStatus(selectedProject.status)
      setFlags(selectedProject.flags || '')
      setServices(
        (selectedProject.services || []).map(s => ({
          id: s.id,
          name: s.name,
          mrr: s.mrr.toString(),
          startDate: s.start_date,
          renewalDate: s.renewal_date,
        }))
      )
    }
  }, [selectedProject, open])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setFormStep(1)
        setName('')
        setClientName('')
        setStatus('active')
        setFlags('')
        setServices([])
      }, 200)
    }
  }, [open])

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault()
    if (formStep === 1 && name && clientName) {
      setFormStep(2)
    } else if (formStep === 2) {
      setFormStep(3)
    }
  }

  const handleBackStep = () => {
    if (formStep === 3) {
      setFormStep(2)
    } else if (formStep === 2) {
      setFormStep(1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      name,
      clientName,
      status,
      flags,
      services,
    })
  }

  const addService = () => {
    setServices([
      ...services,
      {
        name: '',
        mrr: '',
        startDate: new Date().toISOString().split('T')[0],
        renewalDate: '',
      },
    ])
  }

  const removeService = (index: number) => {
    setServices(services.filter((_, i) => i !== index))
  }

  const updateService = (index: number, field: keyof Service, value: string) => {
    const newServices = [...services]
    newServices[index] = { ...newServices[index], [field]: value }
    setServices(newServices)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-2xl">
        {/* Fixed Header */}
        <DialogHeader className="border-b border-border/50 px-6 py-4">
          <DialogTitle>{selectedProject ? 'Edit Project' : 'Create New Project'}</DialogTitle>
          <DialogDescription>
            Step {formStep} of 3: {formStep === 1 ? 'Basic Information' : formStep === 2 ? 'Services' : 'Additional Details'}
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {formStep === 1 && (
            <form onSubmit={handleNextStep} className="space-y-4">
              {/* Project Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Project Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Website Redesign & Development"
                  required
                  className="cursor-text"
                />
              </div>

              {/* Client Name */}
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name</Label>
                <Input
                  id="clientName"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Acme Corporation"
                  required
                  className="cursor-text"
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <Select value={status} onValueChange={(value: 'active' | 'paused' | 'completed') => setStatus(value)}>
                  <SelectTrigger className="cursor-pointer">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROJECT_STATUSES.map((s) => (
                      <SelectItem key={s.id} value={s.id} className="cursor-pointer">
                        {s.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </form>
          )}

          {formStep === 2 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Services</h3>
                  <p className="text-sm text-muted-foreground">Add services for this project</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addService}
                  className="cursor-pointer"
                >
                  <Plus className="mr-2 size-4" />
                  Add Service
                </Button>
              </div>

              {services.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-md border border-dashed py-8">
                  <p className="text-sm text-muted-foreground">No services added yet</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addService}
                    className="mt-2 cursor-pointer"
                  >
                    <Plus className="mr-2 size-4" />
                    Add your first service
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {services.map((service, index) => (
                    <div key={index} className="space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Service {index + 1}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeService(index)}
                          className="cursor-pointer text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        <div className="space-y-2 md:col-span-2">
                          <Label>Service Name</Label>
                          <Input
                            value={service.name}
                            onChange={(e) => updateService(index, 'name', e.target.value)}
                            placeholder="Website Development"
                            required
                            className="cursor-text"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Monthly Recurring Revenue (MRR)</Label>
                          <Input
                            type="number"
                            step="0.01"
                            value={service.mrr}
                            onChange={(e) => updateService(index, 'mrr', e.target.value)}
                            placeholder="5000.00"
                            required
                            className="cursor-text"
                          />
                        </div>

                        <div className="space-y-2">
                          <Label>Start Date</Label>
                          <Input
                            type="date"
                            value={service.startDate}
                            onChange={(e) => updateService(index, 'startDate', e.target.value)}
                            required
                            className="cursor-pointer"
                          />
                        </div>

                        <div className="space-y-2 md:col-span-2">
                          <Label>Renewal Date</Label>
                          <Input
                            type="date"
                            value={service.renewalDate}
                            onChange={(e) => updateService(index, 'renewalDate', e.target.value)}
                            required
                            className="cursor-pointer"
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {formStep === 3 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Flags */}
              <div className="space-y-2">
                <Label htmlFor="flags">Notes & Flags</Label>
                <Textarea
                  id="flags"
                  value={flags}
                  onChange={(e) => setFlags(e.target.value)}
                  placeholder="• Client requested additional revisions&#10;• Waiting on final content&#10;• Next milestone: April 20"
                  rows={6}
                  className="cursor-text font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Add any important notes or flags. Use bullet points for multiple items.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        {/* Fixed Footer */}
        <DialogFooter className="border-t border-border/50 px-6 py-4">
          {formStep > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBackStep}
              disabled={isSaving}
              className="cursor-pointer"
            >
              Back
            </Button>
          )}
          {formStep < 3 ? (
            <Button
              type="button"
              onClick={handleNextStep}
              className="cursor-pointer"
            >
              Next
            </Button>
          ) : (
            <Button
              type="submit"
              onClick={handleSubmit}
              disabled={isSaving}
              className="cursor-pointer"
            >
              {isSaving ? 'Saving...' : selectedProject ? 'Update Project' : 'Create Project'}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
