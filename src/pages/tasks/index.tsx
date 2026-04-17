import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { PlusIcon, FilterIcon } from '@/components/icons'
import { TaskBoard } from './components/TaskBoard'
import { TaskDialog } from './components/TaskDialog'
import { TaskDetailsSheet } from './components/TaskDetailsSheet'
import type { Task, TaskColumn } from './types'

export function TasksPage() {
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [columns, setColumns] = useState<TaskColumn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    if (activeWorkspace?.id && user?.id) {
      fetchUserRole()
      fetchData()
    }
  }, [activeWorkspace?.id, user?.id, showMyTasksOnly])

  const fetchUserRole = async () => {
    if (!activeWorkspace?.id || !user?.id) return

    const { data } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', activeWorkspace.id)
      .eq('user_id', user.id)
      .single()

    if (data) {
      setUserRole(data.role)
    }
  }

  const fetchData = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)

      // Fetch columns
      const { data: columnsData, error: columnsError } = await supabase
        .from('task_columns')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('position')

      if (columnsError) throw columnsError

      // Fetch tasks with relations
      const { data: tasksData, error: tasksError } = await supabase
        .from('tasks')
        .select(`
          *,
          project:projects(id, name)
        `)
        .eq('workspace_id', activeWorkspace.id)
        .order('position')

      // Fetch assignees for all tasks
      const typedTasks = tasksData as unknown as Task[]
      if (typedTasks && typedTasks.length > 0) {
        const taskIds = typedTasks.map(t => t.id)
        const { data: assigneesData } = await supabase
          .from('task_assignees')
          .select(`
            task_id,
            profiles:user_id(id, full_name, email)
          `)
          .in('task_id', taskIds)

        // Map assignees to tasks
        typedTasks.forEach(task => {
          const taskAssignees = assigneesData
            ?.filter((a: { task_id: string }) => a.task_id === task.id)
            .map((a: { profiles: { id: string; full_name: string; email: string } | null }) => a.profiles)
            .filter(Boolean) || []
          ;(task as Task).assignees = taskAssignees as Array<{ id: string; full_name: string; email: string }>
        })
      }

      if (tasksError) throw tasksError

      // Apply "Show my tasks" filter for employees/owners
      let filteredTasks = typedTasks || []
      if (showMyTasksOnly && user?.id && (userRole === 'employee' || userRole === 'owner')) {
        filteredTasks = filteredTasks.filter(task =>
          task.assignees?.some(assignee => assignee.id === user.id)
        )
      }

      setColumns(columnsData || [])
      setTasks(filteredTasks)
    } catch (error) {
      console.error('Error fetching tasks:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateTask = () => {
    setSelectedTask(null)
    setIsTaskDialogOpen(true)
  }

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task)
    setIsSheetOpen(true)
  }

  const handleEditFromSheet = () => {
    setIsSheetOpen(false)
    setIsTaskDialogOpen(true)
  }

  const handleDeleteClick = () => {
    setIsSheetOpen(false)
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!selectedTask) return

    setIsDeleting(true)

    try {
      const { error } = await supabase
        .from('tasks')
        .delete()
        .eq('id', selectedTask.id)

      if (error) throw error

      await fetchData()
      setIsDeleteDialogOpen(false)
      setSelectedTask(null)
    } catch (err) {
      console.error('Error deleting task:', err)
      alert('Failed to delete task')
    } finally {
      setIsDeleting(false)
    }
  }

  const handleDragStart = (task: Task) => {
    setDraggedTask(task)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (targetColumnId: string) => {
    if (!draggedTask || !activeWorkspace?.id) return

    // Store previous state for rollback
    const previousTasks = [...tasks]

    // Optimistically update UI immediately
    setTasks(tasks.map(task =>
      task.id === draggedTask.id
        ? { ...task, column_id: targetColumnId }
        : task
    ))
    setDraggedTask(null)

    try {
      const { error } = await supabase
        .from('tasks')
        .update({ column_id: targetColumnId } as never)
        .eq('id', draggedTask.id)

      if (error) throw error
    } catch (error) {
      console.error('Error updating task:', error)
      // Revert to previous state on error
      setTasks(previousTasks)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">
            Manage your tasks across all projects
          </p>
        </div>
        <div className="flex gap-2">
          {/* Show My Tasks filter - only for employees and owners */}
          {(userRole === 'employee' || userRole === 'owner') && (
            <Button
              variant={showMyTasksOnly ? 'default' : 'outline'}
              onClick={() => setShowMyTasksOnly(!showMyTasksOnly)}
              className="cursor-pointer"
            >
              <FilterIcon className="mr-2 size-4" />
              {showMyTasksOnly ? 'All Tasks' : 'My Tasks'}
            </Button>
          )}
          <Button onClick={handleCreateTask} className="cursor-pointer">
            <PlusIcon className="mr-2 size-4" />
            New Task
          </Button>
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex items-start gap-2 overflow-x-auto pb-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        <TaskBoard
          columns={columns}
          tasks={tasks}
          isLoading={isLoading}
          onRefresh={fetchData}
          onEditTask={handleTaskClick}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
        />
      </div>

      {/* Task Details Sheet */}
      <TaskDetailsSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        task={selectedTask}
        onEdit={handleEditFromSheet}
        onDelete={handleDeleteClick}
      />

      {/* Task Dialog */}
      <TaskDialog
        open={isTaskDialogOpen}
        onOpenChange={setIsTaskDialogOpen}
        task={selectedTask}
        onSuccess={fetchData}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title="Delete Task"
        description={`Are you sure you want to delete "${selectedTask?.title}"? This action cannot be undone.`}
        isDeleting={isDeleting}
      />
    </div>
  )
}
