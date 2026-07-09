import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Calendar } from '@/components/ui/calendar'
import { FormCombobox } from '@/components/ui/form-combobox'
import { SearchIcon } from '@/components/icons'
import { PanelFormRow } from '@/components/layout/PanelFormRow'
import { InfoLine } from '@/components/layout/InfoLine'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { supabase } from '@/lib/supabase'
import { formatDate, formatDateTime, toISODateString } from '@/lib/date'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/hooks/useClickOutside'
import { useAuth } from '@/contexts/AuthContext'
import { logFieldChangeActivity } from '@/lib/tasks/comments'
import { TASK_PRIORITIES } from '../types'
import type { Task, TaskColumn, TaskPriority } from '../types'
import { TaskLabelsField } from './TaskLabelsField'
import { TaskLabelList } from './TaskLabelBadge'

interface Project {
  id: string
  name: string
}

interface Member {
  id: string
  full_name: string
}

type ActiveField = 'status' | 'project' | 'assignees' | 'due' | 'priority' | null

const MAX_VISIBLE_ASSIGNEES = 10
const MAX_PICKER_MEMBERS = 10

type SavingField = ActiveField

interface TaskDetailFieldsProps {
  task: Task
  columns: TaskColumn[]
  onTaskUpdate: (task: Task) => void
  onActivityChange?: () => void
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

function AssigneeSummary({
  assignees,
}: {
  assignees: NonNullable<Task['assignees']>
}) {
  const visible = assignees.slice(0, MAX_VISIBLE_ASSIGNEES)
  const overflow = assignees.length - visible.length

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {visible.map((assignee) => (
        <span key={assignee.id} className="inline-flex items-center gap-1">
          <Avatar className="size-5">
            <AvatarFallback className="bg-violet-600 text-[9px] font-medium text-white">
              {getInitials(assignee.full_name)}
            </AvatarFallback>
          </Avatar>
          <span>{assignee.full_name}</span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-xs text-muted-foreground">+{overflow} more</span>
      )}
    </span>
  )
}

function ClickableValue({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'cursor-pointer text-left text-sm text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
    >
      {children}
    </button>
  )
}

function FieldFormActions({
  isSaving,
  saveDisabled,
  onSave,
  onCancel,
}: {
  isSaving: boolean
  saveDisabled: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <Button
        type="button"
        size="sm"
        disabled={isSaving || saveDisabled}
        onClick={onSave}
        className="h-8 cursor-pointer px-3 text-xs"
      >
        {isSaving ? 'Saving…' : 'Save'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isSaving}
        onClick={onCancel}
        className="h-8 cursor-pointer px-3 text-xs"
      >
        Cancel
      </Button>
    </div>
  )
}

function EditableRow({
  label,
  isActive,
  isSaving,
  display,
  onActivate,
  editor,
  editorRef,
}: {
  label: string
  isActive: boolean
  isSaving?: boolean
  display: React.ReactNode
  onActivate: () => void
  editor: React.ReactNode
  editorRef?: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <PanelFormRow label={label}>
      <div className={cn('min-w-0 transition-opacity', isSaving && 'opacity-60')}>
        {isActive ? (
          <div ref={editorRef}>{editor}</div>
        ) : (
          <ClickableValue onClick={onActivate}>{display}</ClickableValue>
        )}
      </div>
    </PanelFormRow>
  )
}

export function TaskDetailFields({ task, columns, onTaskUpdate, onActivityChange }: TaskDetailFieldsProps) {
  const { activeWorkspace, userRole } = useWorkspace()
  const { user } = useAuth()
  const isStaff = userRole === 'owner' || userRole === 'employee'

  const [projects, setProjects] = useState<Project[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [activeField, setActiveField] = useState<ActiveField>(null)
  const [savingField, setSavingField] = useState<SavingField>(null)
  const [assigneeSearch, setAssigneeSearch] = useState('')
  const [draftColumnId, setDraftColumnId] = useState(task.column_id)
  const [draftProjectId, setDraftProjectId] = useState(task.project_id || 'none')
  const [draftAssigneeIds, setDraftAssigneeIds] = useState<string[]>(
    task.assignees?.map((a) => a.id) ?? [],
  )
  const [draftDueDate, setDraftDueDate] = useState<string | null>(task.due_date || null)
  const [draftPriority, setDraftPriority] = useState(task.priority)
  const activeEditorRef = useRef<HTMLDivElement>(null)

  const resetDraftsFromTask = useCallback(() => {
    setDraftColumnId(task.column_id)
    setDraftProjectId(task.project_id || 'none')
    setDraftAssigneeIds(task.assignees?.map((a) => a.id) ?? [])
    setDraftDueDate(task.due_date || null)
    setDraftPriority(task.priority)
  }, [task])

  const cancelField = useCallback(() => {
    resetDraftsFromTask()
    setActiveField(null)
    setAssigneeSearch('')
  }, [resetDraftsFromTask])

  useClickOutside(activeEditorRef, cancelField, activeField !== null)

  const fetchOptions = useCallback(async () => {
    if (!activeWorkspace?.id) return

    try {
      const [{ data: projectsData }, { data: membersData }] = await Promise.all([
        supabase
          .from('projects')
          .select('id, name')
          .eq('workspace_id', activeWorkspace.id)
          .order('name'),
        supabase
          .from('workspace_members')
          .select('user_id, role, profiles!workspace_members_user_id_fkey(id, full_name, email)')
          .eq('workspace_id', activeWorkspace.id)
          .in('role', ['owner', 'employee']),
      ])

      setProjects(projectsData || [])
      setMembers(
        (membersData || [])
          .map((m: { profiles: { id: string; full_name: string; email: string } | null }) => m.profiles)
          .filter(Boolean)
          .filter((m) => !/^assignee\d+@riftly\.com$/i.test(m.email)) as Member[],
      )
    } catch (err) {
      console.error('Error fetching task field options:', err)
    }
  }, [activeWorkspace?.id])

  useEffect(() => {
    if (isStaff) fetchOptions()
  }, [isStaff, fetchOptions])

  useEffect(() => {
    setActiveField(null)
    setAssigneeSearch('')
    resetDraftsFromTask()
  }, [task.id, resetDraftsFromTask])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelField()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [cancelField])

  const activateField = (field: ActiveField) => {
    if (activeField === field) {
      cancelField()
      return
    }
    resetDraftsFromTask()
    setAssigneeSearch('')
    setActiveField(field)
  }

  const columnName = columns.find((c) => c.id === task.column_id)?.name ?? '—'
  const priorityConfig = TASK_PRIORITIES.find((p) => p.value === task.priority)
  const comboboxClass = 'h-8 border-border-table bg-background text-sm shadow-none'

  const saveTaskFields = async (
    field: SavingField,
    updates: Record<string, unknown>,
    nextTask: Task,
  ): Promise<boolean> => {
    setSavingField(field)
    try {
      const { error } = await supabase
        .from('tasks')
        .update(updates as never)
        .eq('id', task.id)

      if (error) throw error
      onTaskUpdate(nextTask)
      return true
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update task')
      return false
    } finally {
      setSavingField(null)
    }
  }

  const handleSaveStatus = async () => {
    if (draftColumnId === task.column_id) {
      cancelField()
      return
    }
    const saved = await saveTaskFields(
      'status',
      { column_id: draftColumnId },
      { ...task, column_id: draftColumnId },
    )
    if (saved) {
      if (user?.id) {
        void logFieldChangeActivity({
          workspaceId: task.workspace_id,
          taskId: task.id,
          actorId: user.id,
          activityType: 'status_changed',
          metadata: {
            from: columns.find((c) => c.id === task.column_id)?.name ?? '—',
            to: columns.find((c) => c.id === draftColumnId)?.name ?? '—',
          },
        }).then(() => onActivityChange?.())
      }
      cancelField()
    }
  }

  const handleSaveProject = async () => {
    const nextProjectId = draftProjectId === 'none' ? null : draftProjectId
    if (nextProjectId === task.project_id) {
      cancelField()
      return
    }
    const nextProject = nextProjectId
      ? projects.find((p) => p.id === nextProjectId)
      : undefined
    const saved = await saveTaskFields(
      'project',
      { project_id: nextProjectId },
      {
        ...task,
        project_id: nextProjectId,
        project: nextProject ? { id: nextProject.id, name: nextProject.name } : undefined,
      },
    )
    if (saved) cancelField()
  }

  const handleSavePriority = async () => {
    if (draftPriority === task.priority) {
      cancelField()
      return
    }
    const saved = await saveTaskFields(
      'priority',
      { priority: draftPriority },
      { ...task, priority: draftPriority },
    )
    if (saved) {
      if (user?.id) {
        void logFieldChangeActivity({
          workspaceId: task.workspace_id,
          taskId: task.id,
          actorId: user.id,
          activityType: 'priority_changed',
          metadata: { from: task.priority, to: draftPriority },
        }).then(() => onActivityChange?.())
      }
      cancelField()
    }
  }

  const handleSaveDue = async () => {
    if (draftDueDate === (task.due_date || null)) {
      cancelField()
      return
    }
    const saved = await saveTaskFields(
      'due',
      { due_date: draftDueDate },
      { ...task, due_date: draftDueDate },
    )
    if (saved) {
      if (user?.id) {
        void logFieldChangeActivity({
          workspaceId: task.workspace_id,
          taskId: task.id,
          actorId: user.id,
          activityType: 'due_date_changed',
          metadata: {
            from: task.due_date ?? 'none',
            to: draftDueDate ?? 'none',
          },
        }).then(() => onActivityChange?.())
      }
      cancelField()
    }
  }

  const handleSaveAssignees = async () => {
    const currentIds = [...(task.assignees?.map((a) => a.id) ?? [])].sort()
    const nextIds = [...draftAssigneeIds].sort()
    if (currentIds.length === nextIds.length && currentIds.every((id, i) => id === nextIds[i])) {
      cancelField()
      return
    }

    setSavingField('assignees')
    try {
      await supabase.from('task_assignees').delete().eq('task_id', task.id)

      if (draftAssigneeIds.length > 0) {
        const { error } = await supabase.from('task_assignees').insert(
          draftAssigneeIds.map((id) => ({ task_id: task.id, user_id: id })) as never[],
        )
        if (error) throw error
      }

      const nextAssignees = members
        .filter((m) => draftAssigneeIds.includes(m.id))
        .map((m) => ({ id: m.id, full_name: m.full_name, email: '' }))

      onTaskUpdate({ ...task, assignees: nextAssignees })
      if (user?.id) {
        void logFieldChangeActivity({
          workspaceId: task.workspace_id,
          taskId: task.id,
          actorId: user.id,
          activityType: 'assignee_changed',
          metadata: { from_count: currentIds.length, to_count: nextIds.length },
        }).then(() => onActivityChange?.())
      }
      cancelField()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update assignees')
    } finally {
      setSavingField(null)
    }
  }

  const toggleDraftAssignee = (userId: string) => {
    setDraftAssigneeIds((current) =>
      current.includes(userId)
        ? current.filter((id) => id !== userId)
        : [...current, userId],
    )
  }

  const filteredMembers = useMemo(() => {
    const query = assigneeSearch.trim().toLowerCase()
    const sorted = [...members].sort((a, b) => a.full_name.localeCompare(b.full_name))

    if (query) {
      return sorted.filter((member) => member.full_name.toLowerCase().includes(query))
    }

    const selectedIds = new Set(draftAssigneeIds)
    const selected = sorted.filter((member) => selectedIds.has(member.id))
    const unselected = sorted.filter((member) => !selectedIds.has(member.id))
    const visibleUnselected = unselected.slice(0, Math.max(0, MAX_PICKER_MEMBERS - selected.length))

    return [...selected, ...visibleUnselected]
  }, [members, assigneeSearch, draftAssigneeIds])

  const savedAssigneeIds = task.assignees?.map((a) => a.id) ?? []
  const hasAssigneeChanges =
    draftAssigneeIds.length !== savedAssigneeIds.length ||
    draftAssigneeIds.some((id) => !savedAssigneeIds.includes(id))

  const hasMoreMembersToSearch =
    !assigneeSearch.trim() && members.length > filteredMembers.length

  if (!isStaff) {
    return (
      <div className="space-y-2">
        <InfoLine label="Status">{columnName}</InfoLine>
        {task.project && <InfoLine label="Project">{task.project.name}</InfoLine>}
        {task.assignees && task.assignees.length > 0 && (
          <InfoLine label="Assigned to">
            {task.assignees.map((a) => a.full_name).join(', ')}
          </InfoLine>
        )}
        {task.due_date && <InfoLine label="Due">{formatDate(task.due_date)}</InfoLine>}
        {priorityConfig && (
          <InfoLine label="Priority">
            <Badge variant="secondary" className={`text-xs font-medium ${priorityConfig.color}`}>
              {priorityConfig.label}
            </Badge>
          </InfoLine>
        )}
        {task.labels && task.labels.length > 0 && (
          <InfoLine label="Labels">
            <TaskLabelList labels={task.labels} max={10} />
          </InfoLine>
        )}
        <InfoLine label="Created">{formatDateTime(task.created_at)}</InfoLine>
      </div>
    )
  }

  return (
    <div className="space-y-2.5">
      <EditableRow
        label="Status"
        isActive={activeField === 'status'}
        isSaving={savingField === 'status'}
        display={columnName}
        onActivate={() => activateField('status')}
        editorRef={activeField === 'status' ? activeEditorRef : undefined}
        editor={
          <div className="space-y-1">
            <FormCombobox
              value={draftColumnId}
              onValueChange={setDraftColumnId}
              options={columns.map((col) => ({ value: col.id, label: col.name }))}
              placeholder="Select status"
              className={comboboxClass}
            />
            <FieldFormActions
              isSaving={savingField === 'status'}
              saveDisabled={draftColumnId === task.column_id}
              onSave={handleSaveStatus}
              onCancel={cancelField}
            />
          </div>
        }
      />

      <EditableRow
        label="Project"
        isActive={activeField === 'project'}
        isSaving={savingField === 'project'}
        display={task.project?.name || 'No project'}
        onActivate={() => activateField('project')}
        editorRef={activeField === 'project' ? activeEditorRef : undefined}
        editor={
          <div className="space-y-1">
            <FormCombobox
              value={draftProjectId}
              onValueChange={setDraftProjectId}
              options={[
                { value: 'none', label: 'No project' },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              placeholder="Select project"
              className={comboboxClass}
            />
            <FieldFormActions
              isSaving={savingField === 'project'}
              saveDisabled={draftProjectId === (task.project_id || 'none')}
              onSave={handleSaveProject}
              onCancel={cancelField}
            />
          </div>
        }
      />

      <PanelFormRow label="Assignees">
        <div className={cn('min-w-0 transition-opacity', savingField === 'assignees' && 'opacity-60')}>
          {activeField === 'assignees' ? (
            <div
              ref={activeEditorRef}
              className="space-y-2 rounded-sm border border-border-table bg-background p-2.5"
            >
              <div className="relative">
                <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search team members…"
                  value={assigneeSearch}
                  onChange={(e) => setAssigneeSearch(e.target.value)}
                  className="h-8 cursor-text border-border-table pl-9 text-sm shadow-none"
                  autoFocus
                />
              </div>
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {filteredMembers.length === 0 ? (
                  <p className="py-3 text-center text-sm text-muted-foreground">
                    {assigneeSearch.trim() ? 'No members found' : 'No team members available'}
                  </p>
                ) : (
                  filteredMembers.map((member) => {
                    const checked = draftAssigneeIds.includes(member.id)
                    return (
                      <div
                        key={member.id}
                        className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1.5 hover:bg-accent/50"
                        onClick={() => toggleDraftAssignee(member.id)}
                      >
                        <Checkbox checked={checked} className="pointer-events-none" />
                        <Avatar className="size-6">
                          <AvatarFallback className="bg-violet-600 text-[10px] font-medium text-white">
                            {getInitials(member.full_name)}
                          </AvatarFallback>
                        </Avatar>
                        <Label className="flex-1 cursor-pointer text-sm font-normal">
                          {member.full_name}
                        </Label>
                      </div>
                    )
                  })
                )}
              </div>
              {hasMoreMembersToSearch && (
                <p className="text-xs text-muted-foreground">
                  Showing {filteredMembers.length} of {members.length}. Search to find more.
                </p>
              )}
              <FieldFormActions
                isSaving={savingField === 'assignees'}
                saveDisabled={!hasAssigneeChanges}
                onSave={() => void handleSaveAssignees()}
                onCancel={cancelField}
              />
            </div>
          ) : (
            <ClickableValue onClick={() => activateField('assignees')}>
              {task.assignees && task.assignees.length > 0 ? (
                <AssigneeSummary assignees={task.assignees} />
              ) : (
                'Unassigned'
              )}
            </ClickableValue>
          )}
        </div>
      </PanelFormRow>

      <PanelFormRow label="Due">
        <div className={cn('min-w-0 transition-opacity', savingField === 'due' && 'opacity-60')}>
          {activeField === 'due' ? (
            <div
              ref={activeEditorRef}
              className="w-fit overflow-hidden rounded-sm border border-border-table bg-background"
            >
              <Calendar
                mode="single"
                selected={draftDueDate ? new Date(draftDueDate + 'T00:00:00') : undefined}
                onSelect={(date) => setDraftDueDate(date ? toISODateString(date) : null)}
              />
              {draftDueDate && (
                <div className="border-t border-border-table p-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 w-full cursor-pointer text-xs text-muted-foreground"
                    onClick={() => setDraftDueDate(null)}
                  >
                    Clear due date
                  </Button>
                </div>
              )}
              <div className="border-t border-border-table p-2">
                <FieldFormActions
                  isSaving={savingField === 'due'}
                  saveDisabled={draftDueDate === (task.due_date || null)}
                  onSave={handleSaveDue}
                  onCancel={cancelField}
                />
              </div>
            </div>
          ) : (
            <ClickableValue onClick={() => activateField('due')}>
              {task.due_date ? formatDate(task.due_date) : 'No due date'}
            </ClickableValue>
          )}
        </div>
      </PanelFormRow>

      <EditableRow
        label="Priority"
        isActive={activeField === 'priority'}
        isSaving={savingField === 'priority'}
        display={
          priorityConfig ? (
            <Badge variant="secondary" className={`text-xs font-medium ${priorityConfig.color}`}>
              {priorityConfig.label}
            </Badge>
          ) : (
            '—'
          )
        }
        onActivate={() => activateField('priority')}
        editorRef={activeField === 'priority' ? activeEditorRef : undefined}
        editor={
          <div className="space-y-1">
            <FormCombobox
              value={draftPriority}
              onValueChange={(value) => setDraftPriority(value as TaskPriority)}
              options={TASK_PRIORITIES.map((p) => ({ value: p.value, label: p.label }))}
              placeholder="Select priority"
              className={comboboxClass}
            />
            <FieldFormActions
              isSaving={savingField === 'priority'}
              saveDisabled={draftPriority === task.priority}
              onSave={handleSavePriority}
              onCancel={cancelField}
            />
          </div>
        }
      />

      <TaskLabelsField
        task={task}
        isStaff={isStaff}
        onTaskUpdate={onTaskUpdate}
        onActivityChange={onActivityChange}
      />

      <PanelFormRow label="Created">
        <span className="text-sm text-muted-foreground">{formatDateTime(task.created_at)}</span>
      </PanelFormRow>
    </div>
  )
}
