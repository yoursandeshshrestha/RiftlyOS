import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { PlusIcon, CloseIcon } from '@/components/icons'
import { TaskBoard } from './components/TaskBoard'
import { TaskTableView } from './components/TaskTableView'
import { TaskDialog } from './components/TaskDialog'
import { TaskDetailSheet } from './components/TaskDetailSheet'
import { TaskViewSettingsPanel } from './components/TaskViewSettingsPanel'
import { useTaskViewSettings } from './useTaskViewSettings'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageLayout } from '@/components/layout/PageLayout'
import { fetchLabelsForTasks } from '@/lib/tasks/labels'
import { getCommentCountsByTaskIds } from '@/lib/tasks/comments'
import { getLoggedMinutesByTaskIds } from '@/lib/time/entries'
import { formatDateRange, toISODateString } from '@/lib/date'
import type { Task, TaskColumn } from './types'

interface Project {
  id: string
  name: string
}

interface Member {
  id: string
  full_name: string
}

export function TasksPage() {
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [columns, setColumns] = useState<TaskColumn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [draggedTask, setDraggedTask] = useState<Task | null>(null)
  const [detailTask, setDetailTask] = useState<Task | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)

  const {
    viewMode,
    showMyTasksOnly,
    filterProject,
    filterStatus,
    filterPriority,
    filterAssignee,
    filterDueDateFrom,
    filterDueDateTo,
    visibleColumns,
    activeFiltersCount,
    isReady: isViewSettingsReady,
    setViewMode,
    setShowMyTasksOnly,
    setFilterProject,
    setFilterStatus,
    setFilterPriority,
    setFilterAssignee,
    setFilterDueDateFrom,
    setFilterDueDateTo,
    toggleColumn,
    clearAllFilters,
  } = useTaskViewSettings(activeWorkspace?.id, user?.id)

  // Filter options
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (activeWorkspace?.id && user?.id && isViewSettingsReady) {
      fetchUserRole()
      fetchFilterOptions()
      fetchData()
    }
  }, [
    activeWorkspace?.id,
    user?.id,
    isViewSettingsReady,
    showMyTasksOnly,
    filterProject,
    filterStatus,
    filterPriority,
    filterAssignee,
    filterDueDateFrom,
    filterDueDateTo,
  ])

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

  const fetchFilterOptions = async () => {
    if (!activeWorkspace?.id) return

    try {
      // Fetch projects
      const { data: projectsData } = await supabase
        .from('projects')
        .select('id, name')
        .eq('workspace_id', activeWorkspace.id)
        .order('name')

      // Fetch workspace members (exclude clients for assignee filter)
      const { data: membersData } = await supabase
        .from('workspace_members')
        .select('user_id, role, profiles!workspace_members_user_id_fkey(id, full_name, email)')
        .eq('workspace_id', activeWorkspace.id)
        .in('role', ['owner', 'employee'])

      setProjects(projectsData || [])
      setMembers(
        (membersData || []).flatMap(
          (m: { profiles: { id: string; full_name: string; email: string } | null }) => {
            const profile = m.profiles
            if (!profile || /^assignee\d+@riftly\.com$/i.test(profile.email)) return []
            return [{ id: profile.id, full_name: profile.full_name }]
          },
        )
      )
    } catch (err) {
      console.error('Error fetching filter options:', err)
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
            .filter(
              (profile): profile is { id: string; full_name: string; email: string } =>
                !!profile && !/^assignee\d+@riftly\.com$/i.test(profile.email),
            ) || []
          ;(task as Task).assignees = taskAssignees
        })

        const labelsByTask = await fetchLabelsForTasks(taskIds)
        typedTasks.forEach((task) => {
          ;(task as Task).labels = labelsByTask.get(task.id) ?? []
        })

        const loggedByTask = await getLoggedMinutesByTaskIds(taskIds)
        typedTasks.forEach((task) => {
          ;(task as Task).logged_minutes = loggedByTask.get(task.id) ?? 0
        })

        const commentCountsByTask = await getCommentCountsByTaskIds(taskIds)
        typedTasks.forEach((task) => {
          ;(task as Task).comment_count = commentCountsByTask.get(task.id) ?? 0
        })
      }

      if (tasksError) throw tasksError

      // Apply filters for employees/owners
      let filteredTasks = (typedTasks || []).filter(
        (task) => task.title !== 'Demo: 10 assignees UI preview',
      )

      if (userRole === 'employee' || userRole === 'owner') {
        // "Show my tasks" filter
        if (showMyTasksOnly && user?.id) {
          filteredTasks = filteredTasks.filter(task =>
            task.assignees?.some(assignee => assignee.id === user.id)
          )
        }

        // Project filter
        if (filterProject !== 'all') {
          if (filterProject === 'none') {
            filteredTasks = filteredTasks.filter(task => !task.project_id)
          } else {
            filteredTasks = filteredTasks.filter(task => task.project_id === filterProject)
          }
        }

        // Status filter
        if (filterStatus !== 'all') {
          filteredTasks = filteredTasks.filter(task => task.column_id === filterStatus)
        }

        // Priority filter
        if (filterPriority !== 'all') {
          filteredTasks = filteredTasks.filter(task => task.priority === filterPriority)
        }

        // Assignee filter
        if (filterAssignee !== 'all') {
          if (filterAssignee === 'unassigned') {
            filteredTasks = filteredTasks.filter(task => !task.assignees || task.assignees.length === 0)
          } else {
            filteredTasks = filteredTasks.filter(task =>
              task.assignees?.some(assignee => assignee.id === filterAssignee)
            )
          }
        }

        // Due date range filter
        if (filterDueDateFrom) {
          const fromDateStr = toISODateString(filterDueDateFrom)
          filteredTasks = filteredTasks.filter(task =>
            task.due_date && task.due_date >= fromDateStr
          )
        }
        if (filterDueDateTo) {
          const toDateStr = toISODateString(filterDueDateTo)
          filteredTasks = filteredTasks.filter(task =>
            task.due_date && task.due_date <= toDateStr
          )
        }
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
    setDetailTask(task)
    setIsDetailOpen(true)
  }

  const handleDetailOpenChange = (open: boolean) => {
    setIsDetailOpen(open)
  }

  const refreshTaskLoggedMinutes = useCallback(async (taskId: string) => {
    const loggedByTask = await getLoggedMinutesByTaskIds([taskId])
    const logged = loggedByTask.get(taskId) ?? 0
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, logged_minutes: logged } : t)),
    )
    setDetailTask((prev) =>
      prev?.id === taskId ? { ...prev, logged_minutes: logged } : prev,
    )
  }, [])

  const refreshTaskCommentCount = useCallback(async (taskId: string) => {
    const counts = await getCommentCountsByTaskIds([taskId])
    const count = counts.get(taskId) ?? 0
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, comment_count: count } : t)),
    )
    setDetailTask((prev) =>
      prev?.id === taskId ? { ...prev, comment_count: count } : prev,
    )
  }, [])

  const handleTaskUpdate = (updated: Task) => {
    setDetailTask(updated)
    setSelectedTask(updated)
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)))
  }

  const handleDeleteClick = () => {
    setIsDetailOpen(false)
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
    <PageLayout
      header={
        <PageHeader title="Tasks" description="Manage your tasks across all projects">
          <div className="flex items-center gap-2">
            <TaskViewSettingsPanel
              open={showFilters}
              onOpenChange={setShowFilters}
              canFilter={userRole === 'employee' || userRole === 'owner'}
              viewMode={viewMode}
              onViewModeChange={setViewMode}
              showMyTasksOnly={showMyTasksOnly}
              onShowMyTasksOnlyChange={setShowMyTasksOnly}
              filterProject={filterProject}
              onFilterProjectChange={setFilterProject}
              filterStatus={filterStatus}
              onFilterStatusChange={setFilterStatus}
              filterPriority={filterPriority}
              onFilterPriorityChange={setFilterPriority}
              filterAssignee={filterAssignee}
              onFilterAssigneeChange={setFilterAssignee}
              filterDueDateFrom={filterDueDateFrom}
              filterDueDateTo={filterDueDateTo}
              onFilterDueDateFromChange={setFilterDueDateFrom}
              onFilterDueDateToChange={setFilterDueDateTo}
              projects={projects}
              columns={columns}
              members={members}
              activeFiltersCount={activeFiltersCount}
              onClearAll={clearAllFilters}
              visibleColumns={visibleColumns}
              onToggleColumn={toggleColumn}
            />
          </div>
          <Button onClick={handleCreateTask} className="cursor-pointer">
            <PlusIcon className="size-4" />
            New Task
          </Button>
        </PageHeader>
      }
    >
      {/* Active Filters Display */}
      {(userRole === 'employee' || userRole === 'owner') && activeFiltersCount > 0 && (
        <div className="flex flex-wrap gap-2">
          {showMyTasksOnly && (
            <Badge variant="secondary" className="gap-1">
              My Tasks Only
              <button
                onClick={() => setShowMyTasksOnly(false)}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
          {filterProject !== 'all' && (
            <Badge variant="secondary" className="gap-1">
              Project: {filterProject === 'none' ? 'Unassigned' : projects.find(p => p.id === filterProject)?.name}
              <button
                onClick={() => setFilterProject('all')}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
          {filterStatus !== 'all' && (
            <Badge variant="secondary" className="gap-1">
              Status: {columns.find(c => c.id === filterStatus)?.name ?? 'Unknown'}
              <button
                onClick={() => setFilterStatus('all')}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
          {filterPriority !== 'all' && (
            <Badge variant="secondary" className="gap-1">
              Priority: {filterPriority.charAt(0).toUpperCase() + filterPriority.slice(1)}
              <button
                onClick={() => setFilterPriority('all')}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
          {filterAssignee !== 'all' && (
            <Badge variant="secondary" className="gap-1">
              Assignee: {filterAssignee === 'unassigned' ? 'Unassigned' : members.find(m => m.id === filterAssignee)?.full_name}
              <button
                onClick={() => setFilterAssignee('all')}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
          {(filterDueDateFrom || filterDueDateTo) && (
            <Badge variant="secondary" className="gap-1">
              Due: {formatDateRange(filterDueDateFrom, filterDueDateTo)}
              <button
                onClick={() => {
                  setFilterDueDateFrom(undefined)
                  setFilterDueDateTo(undefined)
                }}
                className="ml-1 cursor-pointer rounded-full hover:bg-muted-foreground/20"
              >
                <CloseIcon className="size-3" />
              </button>
            </Badge>
          )}
        </div>
      )}

      {/* Task views */}
      {viewMode === 'board' ? (
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
      ) : (
        <TaskTableView
          tasks={tasks}
          columns={columns}
          visibleColumns={visibleColumns}
          isLoading={isLoading}
          onTaskClick={handleTaskClick}
        />
      )}

      {detailTask && (
        <TaskDetailSheet
          open={isDetailOpen}
          task={detailTask}
          columns={columns}
          onOpenChange={handleDetailOpenChange}
          onDelete={handleDeleteClick}
          onTaskUpdate={handleTaskUpdate}
          onTimerChange={() => refreshTaskLoggedMinutes(detailTask.id)}
          onActivityChange={() => refreshTaskCommentCount(detailTask.id)}
        />
      )}

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
    </PageLayout>
  )
}
