import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { AlertCircleIcon, CalendarIcon, EuroIcon, EditIcon, TrashIcon, PackageIcon, ArrowLeftIcon } from '@/components/icons'
import { ProjectFormDialog } from './ProjectFormDialog'
import { AddServiceDialog } from './AddServiceDialog'
import { FlagsDialog } from './FlagsDialog'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import type { Project } from '../types'

interface ProjectHeaderProps {
  project: Project
  onUpdate: () => void
}

export function ProjectHeader({ project, onUpdate }: ProjectHeaderProps) {
  const navigate = useNavigate()
  const { activeWorkspace, userRole } = useWorkspace()
  const { user } = useAuth()
  const [isEditIconDialogOpen, setIsEditIconDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null)
  const [isAddServiceDialogOpen, setIsAddServiceDialogOpen] = useState(false)
  const [isFlagsDialogOpen, setIsFlagsDialogOpen] = useState(false)

  const getStatusColor = (status: Project['status']) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/20'
      case 'paused':
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-500/20'
      case 'completed':
        return 'bg-gray-500/10 text-gray-700 dark:text-gray-400 hover:bg-gray-500/20'
      default:
        return ''
    }
  }

  const totalMRR = (project.services || []).reduce((sum, service) => sum + Number(service.mrr), 0)

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const isRenewalSoon = (renewalDate: string) => {
    const daysUntilRenewal = Math.ceil((new Date(renewalDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    return daysUntilRenewal <= 30 && daysUntilRenewal >= 0
  }

  const handleSaveProject = async (data: {
    name: string
    status: 'active' | 'paused' | 'completed'
    flags: string
    clientIds: string[]
    employeeIds: string[]
    services: Array<{
      id?: string
      name: string
      mrr: string
      startDate: string
      renewalDate: string
    }>
  }) => {
    if (!activeWorkspace?.id || !user?.id) return

    setError('')
    setIsSaving(true)

    try {
      // Update project
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          name: data.name,
          status: data.status,
          flags: data.flags || null,
        } as never)
        .eq('id', project.id)

      if (updateError) throw updateError

      // Delete existing members
      const { error: deleteMembersError } = await supabase
        .from('project_members')
        .delete()
        .eq('project_id', project.id)

      if (deleteMembersError) throw deleteMembersError

      // Insert new members
      const members = [
        ...data.clientIds.map(id => ({
          project_id: project.id,
          user_id: id,
          member_type: 'client' as const,
        })),
        ...data.employeeIds.map(id => ({
          project_id: project.id,
          user_id: id,
          member_type: 'employee' as const,
        })),
      ]

      if (members.length > 0) {
        const { error: insertMembersError } = await supabase
          .from('project_members')
          .insert(members as never[])

        if (insertMembersError) throw insertMembersError
      }

      // Delete existing services
      const { error: deleteServicesError } = await supabase
        .from('services')
        .delete()
        .eq('project_id', project.id)

      if (deleteServicesError) throw deleteServicesError

      // Insert new services
      if (data.services.length > 0) {
        const { error: insertServicesError } = await supabase
          .from('services')
          .insert(
            data.services.map(service => ({
              workspace_id: activeWorkspace.id,
              project_id: project.id,
              name: service.name,
              mrr: parseFloat(service.mrr) || 0,
              start_date: service.startDate,
              renewal_date: service.renewalDate,
            })) as never[]
          )

        if (insertServicesError) throw insertServicesError
      }

      await onUpdate()
      setIsEditIconDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', project.id)

      if (error) throw error

      navigate('/projects')
    } catch (err) {
      console.error('Error deleting project:', err)
      alert('Failed to delete project')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDeleteService = async () => {
    if (!serviceToDelete) return

    setIsDeleting(true)

    try {
      const { error } = await supabase
        .from('services')
        .delete()
        .eq('id', serviceToDelete)

      if (error) throw error

      await onUpdate()
      setServiceToDelete(null)
    } catch (err) {
      console.error('Error deleting service:', err)
      alert('Failed to delete service')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleAddService = async (serviceData: {
    name: string
    mrr: string
    startDate: string
    renewalDate: string
  }) => {
    if (!activeWorkspace?.id) return

    setError('')
    setIsSaving(true)

    try {
      const { error: insertError } = await supabase
        .from('services')
        .insert({
          workspace_id: activeWorkspace.id,
          project_id: project.id,
          name: serviceData.name,
          mrr: parseFloat(serviceData.mrr) || 0,
          start_date: serviceData.startDate,
          renewal_date: serviceData.renewalDate,
        } as never)

      if (insertError) throw insertError

      await onUpdate()
      setIsAddServiceDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add service')
      throw err
    } finally {
      setIsSaving(false)
    }
  }

  const handleSaveFlags = async (flags: string) => {
    setError('')
    setIsSaving(true)

    try {
      const { error: updateError } = await supabase
        .from('projects')
        .update({
          flags: flags || null,
        } as never)
        .eq('id', project.id)

      if (updateError) throw updateError

      await onUpdate()
      setIsFlagsDialogOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update flags')
      throw err
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <>
      <div className="space-y-6">
        {/* Back Button */}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => navigate('/projects')}
          className="cursor-pointer -ml-2"
        >
          <ArrowLeftIcon className="mr-2 size-4" />
          Back to Projects
        </Button>

        {/* Header Row */}
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-semibold tracking-tight">{project.name}</h1>
            </div>
          </div>
          {userRole === 'owner' && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsEditIconDialogOpen(true)}
                className="cursor-pointer"
              >
                <EditIcon className="mr-2 size-4" />
                Edit
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setIsDeleteDialogOpen(true)}
                className="cursor-pointer"
              >
                <TrashIcon className="mr-2 size-4" />
                Delete
              </Button>
            </div>
          )}
        </div>

        {/* Stats */}
        <div className="flex flex-wrap items-center gap-6 text-sm">
          {/* Status */}
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Status:</span>
            <Badge variant="secondary" className={getStatusColor(project.status)}>
              {project.status.charAt(0).toUpperCase() + project.status.slice(1)}
            </Badge>
          </div>

          {/* Total MRR */}
          {userRole !== 'client' && (
            <div className="flex items-center gap-2">
              <EuroIcon className="size-4 text-muted-foreground" />
              <span className="text-muted-foreground">Total MRR:</span>
              <span className="font-semibold">{formatCurrency(totalMRR)}/month</span>
            </div>
          )}

          {/* Services Count */}
          <div className="flex items-center gap-2">
            <PackageIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Active Services:</span>
            <span className="font-semibold">{project.services?.length || 0}</span>
          </div>

          {/* Next Renewal */}
          <div className="flex items-center gap-2">
            <CalendarIcon className="size-4 text-muted-foreground" />
            <span className="text-muted-foreground">Next Renewal:</span>
            {project.services && project.services.length > 0 ? (
              <span className="font-semibold">
                {formatDate(
                  project.services
                    .map(s => new Date(s.renewal_date))
                    .sort((a, b) => a.getTime() - b.getTime())[0]
                    .toISOString()
                )}
              </span>
            ) : (
              <span className="text-muted-foreground">No services</span>
            )}
          </div>
        </div>

        {/* Services */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-medium">Services</h3>
            {userRole === 'owner' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsAddServiceDialogOpen(true)}
                className="cursor-pointer"
              >
                <PackageIcon className="mr-2 size-4" />
                Add Service
              </Button>
            )}
          </div>
          {project.services && project.services.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {project.services.map((service) => (
                <div key={service.id} className="group relative cursor-pointer overflow-hidden rounded-xl border bg-card p-4 transition-all hover:border-gray-200 dark:hover:border-gray-900">
                  {/* Delete button */}
                  {userRole === 'owner' && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setServiceToDelete(service.id)
                      }}
                      className="absolute right-3 top-3 z-10 cursor-pointer rounded-lg p-1 opacity-0 transition-opacity hover:bg-destructive/10 group-hover:opacity-100"
                    >
                      <TrashIcon className="size-4 text-destructive" />
                    </button>
                  )}

                  {/* Service name */}
                  <h4 className="mb-3 text-base font-semibold text-foreground">
                    {service.name}
                  </h4>

                  {/* Dates */}
                  <div className="mb-3 space-y-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1.5">
                      <CalendarIcon className="size-3" />
                      <span>Started: {formatDate(service.start_date)}</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <CalendarIcon className="size-3" />
                      <span className={isRenewalSoon(service.renewal_date) ? 'text-orange-600 dark:text-orange-400' : ''}>
                        Renews: {formatDate(service.renewal_date)}
                      </span>
                    </div>
                  </div>

                  {/* MRR */}
                  {userRole !== 'client' && (
                    <div className="mb-2">
                      <span className="text-xl font-bold text-foreground">
                        {formatCurrency(Number(service.mrr))}
                      </span>
                      <span className="ml-1 text-xs text-muted-foreground">/mo</span>
                    </div>
                  )}

                  {/* Renewal warning */}
                  {isRenewalSoon(service.renewal_date) && (
                    <div className="absolute right-3 top-3">
                      <Badge variant="secondary" className="bg-orange-500/10 text-orange-700 dark:text-orange-400">
                        Soon
                      </Badge>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No services yet. Add your first service to get started.</p>
          )}
        </div>

        {/* Flags */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-medium">
              <AlertCircleIcon className="size-4 text-orange-500" />
              Notes & Flags
            </h3>
            {userRole === 'owner' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsFlagsDialogOpen(true)}
                className="cursor-pointer"
              >
                <EditIcon className="mr-2 size-4" />
                {project.flags ? 'Edit' : 'Add'}
              </Button>
            )}
          </div>
          {project.flags ? (
            <div className="rounded-lg border bg-card p-4">
              <ul className="list-none space-y-2 text-sm text-foreground">
                {project.flags.split('\n').filter(line => line.trim()).map((point, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="mt-0.5 text-muted-foreground">•</span>
                    <span className="flex-1">{point}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No notes or flags added yet.</p>
          )}
        </div>
      </div>

      {/* EditIcon Dialog */}
      <ProjectFormDialog
        open={isEditIconDialogOpen}
        onOpenChange={setIsEditIconDialogOpen}
        selectedProject={project}
        onSubmit={handleSaveProject}
        isSaving={isSaving}
        error={error}
      />

      {/* Delete Project Dialog */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleDelete}
        title="Delete Project"
        description={`Are you sure you want to delete "${project.name}"? This action cannot be undone and will also delete all associated services and tasks.`}
        isDeleting={isDeleting}
      />

      {/* Delete Service Dialog */}
      <DeleteConfirmDialog
        open={serviceToDelete !== null}
        onOpenChange={(open) => !open && setServiceToDelete(null)}
        onConfirm={handleDeleteService}
        title="Delete Service"
        description="Are you sure you want to delete this service? This action cannot be undone."
        isDeleting={isDeleting}
      />

      {/* Add Service Dialog */}
      <AddServiceDialog
        open={isAddServiceDialogOpen}
        onOpenChange={setIsAddServiceDialogOpen}
        onSubmit={handleAddService}
        isSaving={isSaving}
        error={error}
      />

      {/* Flags Dialog */}
      <FlagsDialog
        open={isFlagsDialogOpen}
        onOpenChange={setIsFlagsDialogOpen}
        onSubmit={handleSaveFlags}
        isSaving={isSaving}
        error={error}
        currentFlags={project.flags || ''}
      />
    </>
  )
}
