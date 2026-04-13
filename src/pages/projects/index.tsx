import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { ProjectsGrid } from './components/ProjectsGrid'
import { ProjectFormDialog } from './components/ProjectFormDialog'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { useNavigate } from 'react-router-dom'
import type { Project } from './types'

export function ProjectsPage() {
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<Project | null>(null)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchProjects()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id])

  const fetchProjects = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)
      const { data: projectsData, error: projectsError } = await supabase
        .from('projects')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('created_at', { ascending: false })

      if (projectsError) throw projectsError

      // Fetch services for each project
      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)

      if (servicesError) throw servicesError

      // Combine projects with their services
      const projectsWithServices = (projectsData || []).map(project => ({
        ...project,
        services: (servicesData || []).filter(service => service.project_id === project.id),
      }))

      setProjects(projectsWithServices)
    } catch (error) {
      console.error('Error fetching projects:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleProjectClick = (project: Project) => {
    navigate(`/projects/${project.id}`)
  }

  const handleSaveProject = async (data: {
    name: string
    clientName: string
    status: 'active' | 'paused' | 'completed'
    flags: string
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
      if (selectedProject) {
        // Update existing project
        const { error: updateError } = await supabase
          .from('projects')
          .update({
            name: data.name,
            client_name: data.clientName,
            status: data.status,
            flags: data.flags || null,
          } as never)
          .eq('id', selectedProject.id)

        if (updateError) throw updateError

        // Delete existing services
        const { error: deleteServicesError } = await supabase
          .from('services')
          .delete()
          .eq('project_id', selectedProject.id)

        if (deleteServicesError) throw deleteServicesError

        // Insert new services
        if (data.services.length > 0) {
          const { error: insertServicesError } = await supabase
            .from('services')
            .insert(
              data.services.map(service => ({
                workspace_id: activeWorkspace.id,
                project_id: selectedProject.id,
                name: service.name,
                mrr: parseFloat(service.mrr) || 0,
                start_date: service.startDate,
                renewal_date: service.renewalDate,
              })) as never[]
            )

          if (insertServicesError) throw insertServicesError
        }
      } else {
        // Create new project
        const { data: newProject, error: createError } = await supabase
          .from('projects')
          .insert({
            workspace_id: activeWorkspace.id,
            name: data.name,
            client_name: data.clientName,
            status: data.status,
            flags: data.flags || null,
            created_by: user.id,
          } as never)
          .select()
          .single()

        if (createError) throw createError

        // Insert services
        if (data.services.length > 0 && newProject) {
          const { error: insertServicesError } = await supabase
            .from('services')
            .insert(
              data.services.map(service => ({
                workspace_id: activeWorkspace.id,
                project_id: (newProject as { id: string }).id,
                name: service.name,
                mrr: parseFloat(service.mrr) || 0,
                start_date: service.startDate,
                renewal_date: service.renewalDate,
              })) as never[]
            )

          if (insertServicesError) throw insertServicesError
        }

        // Navigate to the new project
        if (newProject) {
          navigate(`/projects/${(newProject as { id: string }).id}`)
        }
      }

      await fetchProjects()
      setIsDialogOpen(false)
      setSelectedProject(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : selectedProject ? 'Failed to update project' : 'Failed to create project')
    } finally {
      setIsSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!selectedProject) return

    setIsDeleting(true)

    try {
      const { error } = await supabase
        .from('projects')
        .delete()
        .eq('id', selectedProject.id)

      if (error) throw error

      await fetchProjects()
      setIsDeleteDialogOpen(false)
      setSelectedProject(null)
    } catch (err) {
      console.error('Error deleting project:', err)
      alert('Failed to delete project')
    } finally {
      setIsDeleting(false)
    }
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-muted-foreground">
            Manage your active client projects and services
          </p>
        </div>
        <Button className="cursor-pointer" onClick={() => setIsDialogOpen(true)}>
          <Plus className="mr-2 size-4" />
          New Project
        </Button>
      </div>

      {/* Projects Grid */}
      <ProjectsGrid
        projects={projects}
        isLoading={isLoading}
        onProjectClick={handleProjectClick}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />

      {/* Project Form Dialog */}
      <ProjectFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedProject={selectedProject}
        onSubmit={handleSaveProject}
        isSaving={isSaving}
        error={error}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title="Delete Project"
        description={`Are you sure you want to delete the project "${selectedProject?.name}"? This action cannot be undone and will also delete all associated services.`}
        isDeleting={isDeleting}
      />
    </div>
  )
}
