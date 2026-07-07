import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { BrandLoader } from '@/components/BrandLoader'
import { ProjectHeader } from './components/ProjectHeader'
import type { Project } from './types'

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const [project, setProject] = useState<Project | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (id && activeWorkspace?.id) {
      fetchProject()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, activeWorkspace?.id])

  const fetchProject = async (showLoading = true) => {
    if (!id || !activeWorkspace?.id) return

    try {
      if (showLoading) {
        setIsLoading(true)
      }

      // Fetch project
      const { data: projectData, error: projectError } = await supabase
        .from('projects')
        .select('*')
        .eq('id', id)
        .eq('workspace_id', activeWorkspace.id)
        .single()

      if (projectError) throw projectError

      // Fetch services for this project
      const { data: servicesData, error: servicesError } = await supabase
        .from('services')
        .select('*')
        .eq('project_id', id)
        .eq('workspace_id', activeWorkspace.id)

      if (servicesError) throw servicesError

      setProject({
        ...(projectData as Project),
        services: servicesData || [],
      })
    } catch (error) {
      console.error('Error fetching project:', error)
      navigate('/dashboard')
    } finally {
      if (showLoading) {
        setIsLoading(false)
      }
    }
  }

  const refetchProject = () => fetchProject(false)

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <BrandLoader />
      </div>
    )
  }

  if (!project) {
    return (
      <div className="flex h-screen items-center justify-center">
        <p className="text-muted-foreground">Project not found</p>
      </div>
    )
  }

  return (
    <div>
      {/* Project Header */}
      <ProjectHeader project={project} onUpdate={refetchProject} />
    </div>
  )
}
