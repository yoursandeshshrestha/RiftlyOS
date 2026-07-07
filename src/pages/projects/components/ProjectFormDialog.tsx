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
import { FormCombobox } from '@/components/ui/form-combobox'
import { AlertCircleIcon, PlusIcon, TrashIcon, CloseIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { SelectMembersDialog } from './SelectMembersDialog'
import type { Project } from '../types'
import { PROJECT_STATUSES } from '../types'

interface Service {
  id?: string
  name: string
  mrr: string
  startDate: string
  renewalDate: string
}

interface WorkspaceMember {
  user_id: string
  role: string
  profiles: {
    id: string
    full_name: string
    email: string
  }
}

interface ProjectFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedProject: Project | null
  onSubmit: (data: {
    name: string
    status: 'active' | 'paused' | 'completed'
    flags: string
    clientIds: string[]
    employeeIds: string[]
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
  const { activeWorkspace } = useWorkspace()
  const [formStep, setFormStep] = useState(1)
  const [name, setName] = useState('')
  const [status, setStatus] = useState<'active' | 'paused' | 'completed'>('active')
  const [flags, setFlags] = useState('')
  const [services, setServices] = useState<Service[]>([])
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([])
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([])
  const [clients, setClients] = useState<WorkspaceMember[]>([])
  const [employees, setEmployees] = useState<WorkspaceMember[]>([])
  const [_isLoadingMembers, setIsLoadingMembers] = useState(false)
  const [isClientDialogOpen, setIsClientDialogOpen] = useState(false)
  const [isEmployeeDialogOpen, setIsEmployeeDialogOpen] = useState(false)

  // Fetch workspace members
  useEffect(() => {
    const fetchMembers = async () => {
      if (!activeWorkspace?.id || !open) return

      setIsLoadingMembers(true)
      try {
        const { data, error } = await supabase
          .from('workspace_members')
          .select(`
            user_id,
            role,
            profiles!workspace_members_user_id_fkey (
              id,
              full_name,
              email
            )
          `)
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['client', 'employee'])

        if (error) throw error

        const clientList = (data || []).filter(m => m.role === 'client') as WorkspaceMember[]
        const employeeList = (data || []).filter(m => m.role === 'employee') as WorkspaceMember[]

        setClients(clientList)
        setEmployees(employeeList)
      } catch (error) {
        console.error('Error fetching members:', error)
      } finally {
        setIsLoadingMembers(false)
      }
    }

    fetchMembers()
  }, [activeWorkspace?.id, open])

  // Populate form when editing
  useEffect(() => {
    if (selectedProject && open) {
      setName(selectedProject.name)
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

      const clientIds = (selectedProject.members || [])
        .filter(m => m.member_type === 'client')
        .map(m => m.user_id)
      const employeeIds = (selectedProject.members || [])
        .filter(m => m.member_type === 'employee')
        .map(m => m.user_id)

      setSelectedClientIds(clientIds)
      setSelectedEmployeeIds(employeeIds)
    }
  }, [selectedProject, open])

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setFormStep(1)
        setName('')
        setStatus('active')
        setFlags('')
        setServices([])
        setSelectedClientIds([])
        setSelectedEmployeeIds([])
      }, 200)
    }
  }, [open])

  const handleNextStep = (e: React.FormEvent) => {
    e.preventDefault()
    if (formStep === 1 && name) {
      setFormStep(2)
    } else if (formStep === 2) {
      setFormStep(3)
    } else if (formStep === 3) {
      setFormStep(4)
    }
  }

  const handleBackStep = () => {
    if (formStep === 4) {
      setFormStep(3)
    } else if (formStep === 3) {
      setFormStep(2)
    } else if (formStep === 2) {
      setFormStep(1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSubmit({
      name,
      status,
      flags,
      clientIds: selectedClientIds,
      employeeIds: selectedEmployeeIds,
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

  const removeClient = (clientId: string) => {
    setSelectedClientIds(prev => prev.filter(id => id !== clientId))
  }

  const removeEmployee = (employeeId: string) => {
    setSelectedEmployeeIds(prev => prev.filter(id => id !== employeeId))
  }

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  // Get selected member details
  const selectedClients = clients.filter(c => selectedClientIds.includes(c.user_id))
  const selectedEmployees = employees.filter(e => selectedEmployeeIds.includes(e.user_id))

  const getStepDescription = () => {
    switch (formStep) {
      case 1:
        return 'Basic Information'
      case 2:
        return 'Assign Members'
      case 3:
        return 'Services'
      case 4:
        return 'Additional Details'
      default:
        return ''
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>{selectedProject ? 'Edit Project' : 'Create New Project'}</DialogTitle>
          <DialogDescription>
            Step {formStep} of 4: {getStepDescription()}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {formStep === 1 && (
            <form onSubmit={handleNextStep} className="space-y-4">
              {/* Project Name */}
              <div className="space-y-2">
                <Label htmlFor="name">Project Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Website Redesign & Development"
                  required
                  className="cursor-text"
                />
              </div>

              {/* Status */}
              <div className="space-y-2">
                <Label htmlFor="status">Status</Label>
                <FormCombobox
                  id="status"
                  value={status}
                  onValueChange={(value) => setStatus(value as 'active' | 'paused' | 'completed')}
                  options={PROJECT_STATUSES.map((s) => ({ value: s.id, label: s.label }))}
                  placeholder="Select status"
                />
              </div>
            </form>
          )}

          {formStep === 2 && (
            <div className="space-y-6">
              {/* Clients Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Assign Clients</h3>
                    <p className="text-sm text-muted-foreground">Select clients who can view this project (optional)</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsClientDialogOpen(true)}
                    className="cursor-pointer"
                  >
                    <PlusIcon className="mr-2 size-4" />
                    Add
                  </Button>
                </div>

                {selectedClients.length > 0 ? (
                  <div className="space-y-2">
                    {selectedClients.map((client) => (
                      <div key={client.user_id} className="flex items-center justify-between rounded-md bg-muted/50 p-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs">
                              {getInitials(client.profiles.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-sm font-medium">{client.profiles.full_name}</div>
                            <div className="text-xs text-muted-foreground">{client.profiles.email}</div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeClient(client.user_id)}
                          className="cursor-pointer size-8 p-0"
                        >
                          <CloseIcon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No clients assigned
                  </div>
                )}
              </div>

              {/* Employees Section */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="font-medium">Assign Employees</h3>
                    <p className="text-sm text-muted-foreground">Select employees who will work on this project (optional)</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEmployeeDialogOpen(true)}
                    className="cursor-pointer"
                  >
                    <PlusIcon className="mr-2 size-4" />
                    Add
                  </Button>
                </div>

                {selectedEmployees.length > 0 ? (
                  <div className="space-y-2">
                    {selectedEmployees.map((employee) => (
                      <div key={employee.user_id} className="flex items-center justify-between rounded-md bg-muted/50 p-2">
                        <div className="flex items-center gap-2">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs">
                              {getInitials(employee.profiles.full_name)}
                            </AvatarFallback>
                          </Avatar>
                          <div>
                            <div className="text-sm font-medium">{employee.profiles.full_name}</div>
                            <div className="text-xs text-muted-foreground">{employee.profiles.email}</div>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeEmployee(employee.user_id)}
                          className="cursor-pointer size-8 p-0"
                        >
                          <CloseIcon className="size-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                    No employees assigned
                  </div>
                )}
              </div>
            </div>
          )}

          {formStep === 3 && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-medium">Services</h3>
                  <p className="text-sm text-muted-foreground">Add services for this project (optional)</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addService}
                  className="cursor-pointer"
                >
                  <PlusIcon className="mr-2 size-4" />
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
                    <PlusIcon className="mr-2 size-4" />
                    Add your first service
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {services.map((service, index) => (
                    <div key={index} className="space-y-3 rounded-md border p-4">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">Service {index + 1}</span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeService(index)}
                          className="cursor-pointer text-destructive hover:text-destructive"
                        >
                          <TrashIcon className="size-4" />
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

          {formStep === 4 && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Flags */}
              <div className="space-y-2">
                <Label htmlFor="flags">Notes & Flags</Label>
                <Textarea
                  id="flags"
                  value={flags}
                  onChange={(e) => setFlags(e.target.value)}
                  placeholder=""
                  rows={6}
                  className="cursor-text font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground">
                  Add any important notes or flags. Use bullet points for multiple items.
                </p>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="size-4 shrink-0" />
                  {error}
                </div>
              )}
            </form>
          )}
        </div>

        <DialogFooter className="gap-2">
          <div className="flex w-full justify-between">
            <div>
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
            </div>
            <div>
              {formStep < 4 ? (
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
                  loading={isSaving}
                  className="cursor-pointer"
                >
                  {isSaving ? 'Saving...' : selectedProject ? 'Update Project' : 'Create Project'}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Client Selection Dialog */}
      <SelectMembersDialog
        open={isClientDialogOpen}
        onOpenChange={setIsClientDialogOpen}
        memberType="client"
        selectedIds={selectedClientIds}
        onConfirm={setSelectedClientIds}
      />

      {/* Employee Selection Dialog */}
      <SelectMembersDialog
        open={isEmployeeDialogOpen}
        onOpenChange={setIsEmployeeDialogOpen}
        memberType="employee"
        selectedIds={selectedEmployeeIds}
        onConfirm={setSelectedEmployeeIds}
      />
    </Dialog>
  )
}
