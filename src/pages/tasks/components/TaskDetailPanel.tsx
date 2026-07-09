import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { CloseIcon, TrashIcon } from '@/components/icons'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/hooks/useClickOutside'
import { TASK_PRIORITIES } from '../types'
import type { Task, TaskColumn } from '../types'
import { TaskTimePanel } from './TaskTimePanel'
import { TaskDetailFields } from './TaskDetailFields'
import { TaskDetailTabs } from './TaskDetailTabs'
import { TaskCommentComposer } from './TaskCommentComposer'
import { taskPanelSubsectionClass } from './taskPanelStyles'

interface TaskDetailPanelProps {
  task: Task
  columns: TaskColumn[]
  onClose: () => void
  onDelete: () => void
  onTaskUpdate: (task: Task) => void
  onTimerChange?: () => void
  onActivityChange?: () => void
}

export function TaskDetailPanel({
  task,
  columns,
  onClose,
  onDelete,
  onTaskUpdate,
  onTimerChange,
  onActivityChange,
}: TaskDetailPanelProps) {
  const { userRole } = useWorkspace()
  const isStaff = userRole === 'owner' || userRole === 'employee'
  const priorityConfig = TASK_PRIORITIES.find((p) => p.value === task.priority)

  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description || '')
  const [editingTitle, setEditingTitle] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const [isSavingTitle, setIsSavingTitle] = useState(false)
  const [isSavingDescription, setIsSavingDescription] = useState(false)
  const titleRef = useRef(task.title)
  const descriptionRef = useRef(task.description || '')
  const titleEditorRef = useRef<HTMLDivElement>(null)
  const descriptionEditorRef = useRef<HTMLDivElement>(null)
  const [activityReloadKey, setActivityReloadKey] = useState(0)

  const triggerActivityReload = useCallback(() => {
    setActivityReloadKey((k) => k + 1)
    onActivityChange?.()
  }, [onActivityChange])

  useEffect(() => {
    setTitle(task.title)
    setDescription(task.description || '')
    setEditingTitle(false)
    setEditingDescription(false)
    titleRef.current = task.title
    descriptionRef.current = task.description || ''
  }, [task.id, task.title, task.description])

  const saveTitle = useCallback(async () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitle(titleRef.current)
      setEditingTitle(false)
      toast.error('Title is required')
      return
    }
    if (trimmed === titleRef.current) {
      setEditingTitle(false)
      return
    }

    setIsSavingTitle(true)
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ title: trimmed } as never)
        .eq('id', task.id)

      if (error) throw error

      titleRef.current = trimmed
      onTaskUpdate({ ...task, title: trimmed })
      setEditingTitle(false)
    } catch (err) {
      setTitle(titleRef.current)
      toast.error(err instanceof Error ? err.message : 'Failed to update title')
    } finally {
      setIsSavingTitle(false)
    }
  }, [title, task, onTaskUpdate])

  const saveDescription = useCallback(async () => {
    const nextDescription = description.trim() || null
    if (nextDescription === (descriptionRef.current || null)) {
      setEditingDescription(false)
      return
    }

    setIsSavingDescription(true)
    try {
      const { error } = await supabase
        .from('tasks')
        .update({ description: nextDescription } as never)
        .eq('id', task.id)

      if (error) throw error

      descriptionRef.current = nextDescription || ''
      onTaskUpdate({ ...task, description: nextDescription })
      setEditingDescription(false)
    } catch (err) {
      setDescription(descriptionRef.current)
      toast.error(err instanceof Error ? err.message : 'Failed to update description')
    } finally {
      setIsSavingDescription(false)
    }
  }, [description, task, onTaskUpdate])

  const cancelTitle = useCallback(() => {
    setTitle(titleRef.current)
    setEditingTitle(false)
  }, [])

  const cancelDescription = useCallback(() => {
    setDescription(descriptionRef.current)
    setEditingDescription(false)
  }, [])

  useClickOutside(titleEditorRef, cancelTitle, editingTitle)
  useClickOutside(descriptionEditorRef, cancelDescription, editingDescription)

  const showDescriptionSection = isStaff || !!task.description

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border-table px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-foreground">Task Details</h2>
          {priorityConfig && (
            <Badge variant="secondary" className={`text-xs font-medium ${priorityConfig.color}`}>
              {priorityConfig.label}
            </Badge>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          {userRole === 'owner' && (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer text-destructive hover:text-destructive"
              onClick={onDelete}
              aria-label="Delete task"
            >
              <TrashIcon className="size-4" />
            </Button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close task details"
          >
            <CloseIcon className="size-4" />
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="shrink-0 space-y-3 border-b border-border-table bg-background px-4 py-3">
          {isStaff && editingTitle ? (
            <div ref={titleEditorRef} className="space-y-2">
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void saveTitle()
                  }
                  if (e.key === 'Escape') cancelTitle()
                }}
                placeholder="Task title"
                autoFocus
                className={cn(
                  'border-border-table bg-background text-base font-semibold shadow-none',
                  isSavingTitle && 'opacity-60',
                )}
              />
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    isSavingTitle || !title.trim() || title.trim() === titleRef.current
                  }
                  onClick={() => void saveTitle()}
                  className="h-8 cursor-pointer px-3 text-xs"
                >
                  {isSavingTitle ? 'Saving…' : 'Save'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isSavingTitle}
                  onClick={cancelTitle}
                  className="h-8 cursor-pointer px-3 text-xs"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : isStaff ? (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className={cn(
                'wrap-break-word text-left text-base font-semibold text-foreground',
                'cursor-pointer transition-colors hover:text-foreground/80',
              )}
            >
              {task.title}
            </button>
          ) : (
            <p className="wrap-break-word text-base font-semibold text-foreground">{task.title}</p>
          )}

          {isStaff && (
            <TaskTimePanel
              taskId={task.id}
              workspaceId={task.workspace_id}
              initialEstimateMinutes={task.estimated_minutes}
              onEstimateChange={(minutes) =>
                onTaskUpdate({ ...task, estimated_minutes: minutes > 0 ? minutes : null })
              }
              onTimerChange={onTimerChange}
            />
          )}

          <div className="border-t border-border-table pt-3">
            <TaskDetailFields
              task={task}
              columns={columns}
              onTaskUpdate={onTaskUpdate}
              onActivityChange={triggerActivityReload}
            />
          </div>
        </div>

        {showDescriptionSection && (
          <div className="shrink-0 border-b border-border-table bg-background px-4 py-3">
            <p className="mb-2 text-sm font-medium text-foreground">Description</p>
            {isStaff && editingDescription ? (
              <div ref={descriptionEditorRef} className="space-y-2">
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') cancelDescription()
                  }}
                  placeholder="Add a description…"
                  rows={6}
                  autoFocus
                  className={cn(
                    'min-h-32 resize-y border-border-table bg-background text-sm leading-relaxed shadow-none',
                    isSavingDescription && 'opacity-60',
                  )}
                />
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    disabled={
                      isSavingDescription ||
                      (description.trim() || null) === (descriptionRef.current || null)
                    }
                    onClick={() => void saveDescription()}
                    className="h-8 cursor-pointer px-3 text-xs"
                  >
                    {isSavingDescription ? 'Saving…' : 'Save'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={isSavingDescription}
                    onClick={cancelDescription}
                    className="h-8 cursor-pointer px-3 text-xs"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : isStaff ? (
              <button
                type="button"
                onClick={() => setEditingDescription(true)}
                className={cn(
                  'w-full text-left text-sm leading-relaxed transition-colors hover:text-foreground/80',
                  'cursor-pointer',
                  task.description
                    ? 'whitespace-pre-wrap text-muted-foreground'
                    : 'text-muted-foreground/60 italic',
                )}
              >
                {task.description || 'Add a description…'}
              </button>
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                {task.description}
              </p>
            )}
          </div>
        )}

          <div className={cn('flex-1', taskPanelSubsectionClass)}>
            <TaskDetailTabs
              taskId={task.id}
              workspaceId={task.workspace_id}
              reloadKey={activityReloadKey}
              onActivityChange={triggerActivityReload}
            />
          </div>
        </div>

        <TaskCommentComposer
          taskId={task.id}
          workspaceId={task.workspace_id}
          onPosted={triggerActivityReload}
        />
      </div>
    </div>
  )
}
