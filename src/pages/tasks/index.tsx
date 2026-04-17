import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { Badge } from '@/components/ui/badge'
import { PlusIcon, FilterIcon, CloseIcon } from '@/components/icons'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Calendar } from '@/components/ui/calendar'
import { CalendarIcon } from '@/components/icons'
import { format } from 'date-fns'
import { TaskBoard } from './components/TaskBoard'
import { TaskDialog } from './components/TaskDialog'
import { TaskDetailsSheet } from './components/TaskDetailsSheet'
import type { Task, TaskColumn, TaskPriority } from './types'

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
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showMyTasksOnly, setShowMyTasksOnly] = useState(false)
  const [userRole, setUserRole] = useState<string | null>(null)

  // Filter states
  const [filterProject, setFilterProject] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [filterAssignee, setFilterAssignee] = useState<string>('all')
  const [filterDueDateFrom, setFilterDueDateFrom] = useState<Date | undefined>()
  const [filterDueDateTo, setFilterDueDateTo] = useState<Date | undefined>()
  const [showFilters, setShowFilters] = useState(false)
  const [showFromCalendar, setShowFromCalendar] = useState(false)
  const [showToCalendar, setShowToCalendar] = useState(false)

  // Filter options
  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    if (activeWorkspace?.id && user?.id) {
      fetchUserRole()
      fetchFilterOptions()
      fetchData()
    }
  }, [activeWorkspace?.id, user?.id, showMyTasksOnly, filterProject, filterPriority, filterAssignee, filterDueDateFrom, filterDueDateTo])

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
        .select('user_id, role, profiles!workspace_members_user_id_fkey(id, full_name)')
        .eq('workspace_id', activeWorkspace.id)
        .in('role', ['owner', 'employee'])

      setProjects(projectsData || [])
      setMembers(
        (membersData || [])
          .map((m: { profiles: { id: string; full_name: string } | null }) => m.profiles)
          .filter(Boolean) as Member[]
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
            .filter(Boolean) || []
          ;(task as Task).assignees = taskAssignees as Array<{ id: string; full_name: string; email: string }>
        })
      }

      if (tasksError) throw tasksError

      // Apply filters for employees/owners
      let filteredTasks = typedTasks || []

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
          const fromDateStr = format(filterDueDateFrom, 'yyyy-MM-dd')
          filteredTasks = filteredTasks.filter(task =>
            task.due_date && task.due_date >= fromDateStr
          )
        }
        if (filterDueDateTo) {
          const toDateStr = format(filterDueDateTo, 'yyyy-MM-dd')
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

  const getActiveFiltersCount = () => {
    let count = 0
    if (showMyTasksOnly) count++
    if (filterProject !== 'all') count++
    if (filterPriority !== 'all') count++
    if (filterAssignee !== 'all') count++
    if (filterDueDateFrom || filterDueDateTo) count++
    return count
  }

  const clearAllFilters = () => {
    setShowMyTasksOnly(false)
    setFilterProject('all')
    setFilterPriority('all')
    setFilterAssignee('all')
    setFilterDueDateFrom(undefined)
    setFilterDueDateTo(undefined)
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
          {/* Filters - only for employees and owners */}
          {(userRole === 'employee' || userRole === 'owner') && (
            <Popover open={showFilters} onOpenChange={setShowFilters}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="cursor-pointer relative">
                  <FilterIcon className="mr-2 size-4" />
                  Filters
                  {getActiveFiltersCount() > 0 && (
                    <Badge variant="default" className="ml-2 size-5 rounded-full p-0 flex items-center justify-center text-[10px]">
                      {getActiveFiltersCount()}
                    </Badge>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 z-50">
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium">Filters</h4>
                    {getActiveFiltersCount() > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearAllFilters}
                        className="cursor-pointer h-auto p-1 text-xs"
                      >
                        Clear all
                      </Button>
                    )}
                  </div>

                  {/* My Tasks Toggle */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Quick Filter</label>
                    <Button
                      variant={showMyTasksOnly ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setShowMyTasksOnly(!showMyTasksOnly)}
                      className="w-full cursor-pointer"
                    >
                      {showMyTasksOnly ? '✓ My Tasks Only' : 'My Tasks Only'}
                    </Button>
                  </div>

                  {/* Project Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Project</label>
                    <Select value={filterProject} onValueChange={setFilterProject}>
                      <SelectTrigger className="cursor-pointer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all" className="cursor-pointer">All Projects</SelectItem>
                        <SelectItem value="none" className="cursor-pointer">Unassigned</SelectItem>
                        {projects.map((project) => (
                          <SelectItem key={project.id} value={project.id} className="cursor-pointer">
                            {project.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Priority Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Priority</label>
                    <Select value={filterPriority} onValueChange={setFilterPriority}>
                      <SelectTrigger className="cursor-pointer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all" className="cursor-pointer">All Priorities</SelectItem>
                        <SelectItem value="high" className="cursor-pointer">High</SelectItem>
                        <SelectItem value="medium" className="cursor-pointer">Medium</SelectItem>
                        <SelectItem value="low" className="cursor-pointer">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Assignee Filter */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Assignee</label>
                    <Select value={filterAssignee} onValueChange={setFilterAssignee}>
                      <SelectTrigger className="cursor-pointer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        <SelectItem value="all" className="cursor-pointer">All Assignees</SelectItem>
                        <SelectItem value="unassigned" className="cursor-pointer">Unassigned</SelectItem>
                        {members.map((member) => (
                          <SelectItem key={member.id} value={member.id} className="cursor-pointer">
                            {member.full_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Due Date Range */}
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Due Date Range</label>
                    <div className="grid grid-cols-2 gap-2">
                      {/* From Date */}
                      <Popover open={showFromCalendar} onOpenChange={setShowFromCalendar}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="cursor-pointer justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {filterDueDateFrom ? format(filterDueDateFrom, 'MMM dd') : 'From'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-100" align="start">
                          <Calendar
                            mode="single"
                            selected={filterDueDateFrom}
                            onSelect={(date) => {
                              setFilterDueDateFrom(date)
                              setShowFromCalendar(false)
                            }}
                          />
                        </PopoverContent>
                      </Popover>

                      {/* To Date */}
                      <Popover open={showToCalendar} onOpenChange={setShowToCalendar}>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className="cursor-pointer justify-start text-left font-normal"
                          >
                            <CalendarIcon className="mr-2 size-4" />
                            {filterDueDateTo ? format(filterDueDateTo, 'MMM dd') : 'To'}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0 z-100" align="start">
                          <Calendar
                            mode="single"
                            selected={filterDueDateTo}
                            onSelect={(date) => {
                              setFilterDueDateTo(date)
                              setShowToCalendar(false)
                            }}
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <Button onClick={handleCreateTask} className="cursor-pointer">
            <PlusIcon className="mr-2 size-4" />
            New Task
          </Button>
        </div>
      </div>

      {/* Active Filters Display */}
      {(userRole === 'employee' || userRole === 'owner') && getActiveFiltersCount() > 0 && (
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
              Due: {filterDueDateFrom ? format(filterDueDateFrom, 'MMM dd, yyyy') : '...'} to {filterDueDateTo ? format(filterDueDateTo, 'MMM dd, yyyy') : '...'}
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
