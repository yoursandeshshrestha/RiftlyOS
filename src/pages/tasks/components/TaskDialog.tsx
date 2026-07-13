import { useState, useEffect } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { FormCombobox } from '@/components/ui/form-combobox'
import { CalendarIcon, ArrowLeftIcon, ArrowRightIcon, UserPlusIcon, CloseIcon, SearchIcon } from '@/components/icons'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { TASK_PRIORITIES } from '../types'
import type { Task, TaskPriority, TaskColumn } from '../types'

interface Project {
  id: string
  name: string
}

interface Member {
  id: string
  full_name: string
}

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  task: Task | null
  onSuccess: () => void
}

export function TaskDialog({ open, onOpenChange, task, onSuccess }: TaskDialogProps) {
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState('')
  const [currentStep, setCurrentStep] = useState(1)
  const totalSteps = 2

  // Form fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<TaskPriority>('medium')
  const [projectId, setProjectId] = useState<string>('')
  const [columnId, setColumnId] = useState<string>('')
  const [assignedTo, setAssignedTo] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')

  // Assignee selection modal
  const [showAssigneeModal, setShowAssigneeModal] = useState(false)
  const [assigneeSearch, setAssigneeSearch] = useState('')

  // Options
  const [projects, setProjects] = useState<Project[]>([])
  const [columns, setColumns] = useState<TaskColumn[]>([])
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (open && activeWorkspace?.id) {
      fetchOptions()
      setCurrentStep(1)
      setAssigneeSearch('')
      setShowAssigneeModal(false)

      if (task) {
        // Edit mode - populate form
        setTitle(task.title)
        setDescription(task.description || '')
        setPriority(task.priority)
        setProjectId(task.project_id || '')
        setColumnId(task.column_id)
        setAssignedTo(task.assignees?.map(a => a.id) || [])
        setDueDate(task.due_date || '')
      } else {
        // Create mode - reset form
        resetForm()
      }
    }
  }, [open, task, activeWorkspace?.id])

  const fetchOptions = async () => {
    if (!activeWorkspace?.id) return

    try {
      // Fetch projects
      const { data: projectsData } = await supabase
        .from('projects')
        .select('id, name')
        .eq('workspace_id', activeWorkspace.id)
        .order('name')

      // Fetch columns
      const { data: columnsData } = await supabase
        .from('task_columns')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('position')

      // Fetch workspace members (exclude clients)
      const { data: membersData } = await supabase
        .from('workspace_members')
        .select('user_id, role, profiles!workspace_members_user_id_fkey(id, full_name, email)')
        .eq('workspace_id', activeWorkspace.id)
        .in('role', ['owner', 'employee'])

      const typedColumns = (columnsData || []) as TaskColumn[]

      setProjects(projectsData || [])
      setColumns(typedColumns)
      setMembers(
        (membersData || []).flatMap(
          (m: { profiles: { id: string; full_name: string; email: string } | null }) => {
            const profile = m.profiles
            if (!profile || /^assignee\d+@riftly\.com$/i.test(profile.email)) return []
            return [{ id: profile.id, full_name: profile.full_name }]
          },
        )
      )

      // Set default column if creating new task
      if (!task && typedColumns && typedColumns.length > 0) {
        setColumnId(typedColumns[0].id)
      }
    } catch (err) {
      console.error('Error fetching options:', err)
    }
  }

  const resetForm = () => {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setProjectId('')
    setColumnId(columns[0]?.id || '')
    setAssignedTo([])
    setDueDate('')
    setAssigneeSearch('')
    setShowAssigneeModal(false)
    setError('')
    setCurrentStep(1)
  }

  const handleNext = () => {
    if (currentStep < totalSteps) {
      setCurrentStep(currentStep + 1)
    }
  }

  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!activeWorkspace?.id || !columnId || !user?.id) return

    setError('')
    setIsSaving(true)

    try {
      const taskData = {
        workspace_id: activeWorkspace.id,
        title,
        description: description || null,
        priority,
        project_id: projectId || null,
        column_id: columnId,
        due_date: dueDate || null,
        position: 0, // Will be updated by backend if needed
        created_by: user.id,
      }

      let taskId: string

      if (task) {
        // Update existing task (exclude created_by as it shouldn't be changed)
        const { created_by, ...updateData } = taskData
        const { error: updateError } = await supabase
          .from('tasks')
          .update(updateData as never)
          .eq('id', task.id)

        if (updateError) throw updateError
        taskId = task.id

        // Delete existing assignees
        await supabase
          .from('task_assignees')
          .delete()
          .eq('task_id', task.id)
      } else {
        // Create new task
        const { data: newTask, error: insertError } = await supabase
          .from('tasks')
          .insert(taskData as never)
          .select('id')
          .single()

        if (insertError) throw insertError
        taskId = (newTask as { id: string }).id
      }

      // Insert assignees
      if (assignedTo.length > 0) {
        const assigneesData = assignedTo.map(userId => ({
          task_id: taskId,
          user_id: userId,
        }))

        const { error: assigneesError } = await supabase
          .from('task_assignees')
          .insert(assigneesData as never[])

        if (assigneesError) throw assigneesError
      }

      await onSuccess()
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save task')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCancel = () => {
    resetForm()
    onOpenChange(false)
  }

  const filteredMembers = members.filter((member) =>
    member.full_name.toLowerCase().includes((assigneeSearch || '').toLowerCase())
  )

  const getSelectedMembers = () => {
    return members.filter((m) => (assignedTo || []).includes(m.id))
  }

  const toggleAssignee = (userId: string) => {
    if (assignedTo.includes(userId)) {
      setAssignedTo(assignedTo.filter(id => id !== userId))
    } else {
      setAssignedTo([...assignedTo, userId])
    }
  }

  const removeAssignee = (userId: string) => {
    setAssignedTo(assignedTo.filter(id => id !== userId))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {task ? 'Edit Task' : 'Create New Task'} - Step {currentStep} of {totalSteps}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Step 1: Basic Information */}
          {currentStep === 1 && (
            <div className="space-y-4">
              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Task title"
                  required
                  className="cursor-text"
                />
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Add a description..."
                  rows={4}
                  className="min-h-[100px] cursor-text resize-none py-2"
                />
              </div>

              {/* Priority */}
              <div className="space-y-2">
                <Label htmlFor="priority">Priority</Label>
                <FormCombobox
                  id="priority"
                  value={priority}
                  onValueChange={(value) => setPriority(value as TaskPriority)}
                  options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
                  placeholder="Select priority"
                />
              </div>
            </div>
          )}

          {/* Step 2: Assignment & Timeline */}
          {currentStep === 2 && (
            <div className="space-y-4">
              {/* Status/Column */}
              <div className="space-y-2">
                <Label htmlFor="column">Status</Label>
                <FormCombobox
                  id="column"
                  value={columnId}
                  onValueChange={setColumnId}
                  options={columns.map((col) => ({ value: col.id, label: col.name }))}
                  placeholder="Select status"
                />
              </div>

              {/* Project */}
              <div className="space-y-2">
                <Label htmlFor="project">Project</Label>
                <FormCombobox
                  id="project"
                  value={projectId || 'none'}
                  onValueChange={(val) => setProjectId(val === 'none' ? '' : val)}
                  options={[
                    { value: 'none', label: 'None' },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                  placeholder="Select project"
                />
              </div>

              {/* Assignees */}
              <div className="space-y-2">
                <Label>Assign to</Label>
                <div className="space-y-2">
                  {/* Selected assignees */}
                  {getSelectedMembers().length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {getSelectedMembers().map((member) => (
                        <Badge key={member.id} variant="secondary" className="gap-1 pr-1">
                          {member.full_name}
                          <button
                            type="button"
                            onClick={() => removeAssignee(member.id)}
                            className="ml-1 rounded-full p-0.5 hover:bg-muted-foreground/20"
                          >
                            <CloseIcon className="size-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Add button */}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setShowAssigneeModal(true)}
                    className="cursor-pointer"
                  >
                    <UserPlusIcon className="mr-2 size-4" />
                    {assignedTo.length > 0 ? 'Add More' : 'Add Assignees'}
                  </Button>
                </div>
                {assignedTo.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {assignedTo.length} {assignedTo.length === 1 ? 'person' : 'people'} assigned
                  </p>
                )}
              </div>

              {/* Due Date */}
              <div className="space-y-2">
                <Label htmlFor="due-date">Due Date</Label>
                <div className="relative">
                  <CalendarIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="due-date"
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className="cursor-text pl-10"
                  />
                </div>
              </div>
            </div>
          )}
        </form>

        {/* Footer with navigation */}
        <DialogFooter className="gap-2">
          <div className="flex w-full justify-between">
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancel}
                disabled={isSaving}
                className="cursor-pointer"
              >
                Cancel
              </Button>
            </div>
            <div className="flex gap-2">
              {currentStep > 1 && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleBack}
                  disabled={isSaving}
                  className="cursor-pointer"
                >
                  <ArrowLeftIcon className="mr-2 size-4" />
                  Back
                </Button>
              )}
              {currentStep < totalSteps ? (
                <Button
                  type="button"
                  onClick={handleNext}
                  disabled={!title}
                  className="cursor-pointer"
                >
                  Next
                  <ArrowRightIcon className="ml-2 size-4" />
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={handleSubmit}
                  loading={isSaving}
                  disabled={!title}
                  className="cursor-pointer"
                >
                  {isSaving ? 'Saving...' : task ? 'Update Task' : 'Create Task'}
                </Button>
              )}
            </div>
          </div>
        </DialogFooter>
      </DialogContent>

      {/* Assignee Selection Modal */}
      {showAssigneeModal && (
        <DialogContent className="sm:max-w-[425px]" onPointerDownOutside={() => setShowAssigneeModal(false)}>
          <DialogHeader>
            <DialogTitle>Select Assignees</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Search input */}
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search team members..."
                value={assigneeSearch}
                onChange={(e) => setAssigneeSearch(e.target.value)}
                className="cursor-text pl-10"
              />
            </div>

            {/* Members list */}
            <div className="max-h-[300px] space-y-2 overflow-y-auto rounded-md border p-3">
              {filteredMembers.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">
                  {assigneeSearch ? 'No team members found' : 'No team members available'}
                </p>
              ) : (
                filteredMembers.map((member) => (
                  <div key={member.id} className="flex items-center gap-2">
                    <Checkbox
                      id={`assignee-modal-${member.id}`}
                      checked={assignedTo.includes(member.id)}
                      onCheckedChange={() => toggleAssignee(member.id)}
                      className="cursor-pointer"
                    />
                    <Label
                      htmlFor={`assignee-modal-${member.id}`}
                      className="flex-1 cursor-pointer text-sm font-normal"
                    >
                      {member.full_name}
                    </Label>
                  </div>
                ))
              )}
            </div>

            {assignedTo.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {assignedTo.length} {assignedTo.length === 1 ? 'person' : 'people'} selected
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowAssigneeModal(false)
                setAssigneeSearch('')
              }}
              className="cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              onClick={() => {
                setShowAssigneeModal(false)
                setAssigneeSearch('')
              }}
              className="cursor-pointer"
            >
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      )}
    </Dialog>
  )
}
