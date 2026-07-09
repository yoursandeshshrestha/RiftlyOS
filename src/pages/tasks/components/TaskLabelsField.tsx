import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { PanelFormRow } from '@/components/layout/PanelFormRow'
import { InfoLine } from '@/components/layout/InfoLine'
import { useAuth } from '@/contexts/AuthContext'
import { useClickOutside } from '@/hooks/useClickOutside'
import { cn } from '@/lib/utils'
import { TrashIcon } from '@/components/icons'
import {
  createLabel,
  deleteLabel,
  getWorkspaceLabels,
  setTaskLabels,
} from '@/lib/tasks/labels'
import { TASK_LABEL_COLORS, type Task, type TaskLabel } from '../types'
import { TaskLabelList } from './TaskLabelBadge'

interface TaskLabelsFieldProps {
  task: Task
  isStaff: boolean
  onTaskUpdate: (task: Task) => void
  onActivityChange?: () => void
}

function ClickableValue({
  children,
  onClick,
}: {
  children: React.ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="cursor-pointer text-left text-sm text-muted-foreground transition-colors hover:text-foreground"
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

export function TaskLabelsField({
  task,
  isStaff,
  onTaskUpdate,
  onActivityChange,
}: TaskLabelsFieldProps) {
  const { user } = useAuth()
  const [isActive, setIsActive] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [workspaceLabels, setWorkspaceLabels] = useState<TaskLabel[]>([])
  const [draftLabelIds, setDraftLabelIds] = useState<string[]>([])
  const [newLabelName, setNewLabelName] = useState('')
  const [newLabelColor, setNewLabelColor] = useState<string>(TASK_LABEL_COLORS[0])
  const editorRef = useRef<HTMLDivElement>(null)

  const labelIdsKey = useMemo(
    () => (task.labels?.map((l) => l.id) ?? []).slice().sort().join(','),
    [task.labels],
  )
  const savedLabelIds = useMemo(
    () => (labelIdsKey ? labelIdsKey.split(',') : []),
    [labelIdsKey],
  )

  const resetDraft = useCallback(() => {
    setDraftLabelIds(savedLabelIds)
    setNewLabelName('')
    setNewLabelColor(TASK_LABEL_COLORS[0])
  }, [savedLabelIds])

  const cancel = useCallback(() => {
    resetDraft()
    setIsActive(false)
  }, [resetDraft])

  useClickOutside(editorRef, cancel, isActive)

  useEffect(() => {
    resetDraft()
    setIsActive(false)
  }, [task.id]) // eslint-disable-line react-hooks/exhaustive-deps -- only reset when switching tasks

  useEffect(() => {
    if (!isActive) resetDraft()
  }, [labelIdsKey, isActive, resetDraft])

  useEffect(() => {
    if (!isStaff || !task.workspace_id) return
    void getWorkspaceLabels(task.workspace_id)
      .then(setWorkspaceLabels)
      .catch((err) => console.error('Failed to load labels:', err))
  }, [isStaff, task.workspace_id])

  const hasPendingNewLabel = newLabelName.trim().length > 0

  const hasAssignmentChanges = useMemo(() => {
    const draft = new Set(draftLabelIds)
    const saved = new Set(savedLabelIds)
    if (draft.size !== saved.size) return true
    for (const id of draft) {
      if (!saved.has(id)) return true
    }
    return false
  }, [draftLabelIds, savedLabelIds])

  const handleSave = async () => {
    if (!user?.id || !hasAssignmentChanges) {
      cancel()
      return
    }

    setIsSaving(true)
    try {
      await setTaskLabels(
        task.id,
        task.workspace_id,
        user.id,
        savedLabelIds,
        draftLabelIds,
      )
      const nextLabels = workspaceLabels.filter((l) => draftLabelIds.includes(l.id))
      onTaskUpdate({ ...task, labels: nextLabels })
      onActivityChange?.()
      setIsActive(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update labels')
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateLabel = async () => {
    const name = newLabelName.trim()
    if (!name) return

    setIsSaving(true)
    try {
      const created = await createLabel(task.workspace_id, name, newLabelColor)
      setWorkspaceLabels((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)))
      setDraftLabelIds((prev) => [...prev, created.id])
      setNewLabelName('')
      setNewLabelColor(TASK_LABEL_COLORS[0])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create label')
    } finally {
      setIsSaving(false)
    }
  }

  const toggleLabel = (labelId: string) => {
    setDraftLabelIds((current) =>
      current.includes(labelId)
        ? current.filter((id) => id !== labelId)
        : [...current, labelId],
    )
  }

  const handleDeleteLabel = async (label: TaskLabel, event: React.MouseEvent) => {
    event.stopPropagation()

    try {
      await deleteLabel(label.id)
      setWorkspaceLabels((prev) => prev.filter((l) => l.id !== label.id))
      setDraftLabelIds((prev) => prev.filter((id) => id !== label.id))

      if (task.labels?.some((l) => l.id === label.id)) {
        onTaskUpdate({
          ...task,
          labels: task.labels.filter((l) => l.id !== label.id),
        })
        onActivityChange?.()
      }

      toast.success(`Deleted label "${label.name}"`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete label')
    }
  }

  if (!isStaff) {
    if (!task.labels?.length) return null
    return (
      <InfoLine label="Labels">
        <TaskLabelList labels={task.labels} max={10} />
      </InfoLine>
    )
  }

  return (
    <PanelFormRow label="Labels">
      <div className={cn('min-w-0 transition-opacity', isSaving && 'opacity-60')}>
        {isActive ? (
          <div ref={editorRef} className="space-y-2">
            <div className="max-h-40 space-y-1 overflow-y-auto rounded-sm border border-border-table bg-background p-2">
              {workspaceLabels.length === 0 ? (
                <p className="py-2 text-center text-sm text-muted-foreground">No labels yet</p>
              ) : (
                workspaceLabels.map((label) => (
                  <div
                    key={label.id}
                    className="flex cursor-pointer items-center gap-2 rounded-sm px-1 py-1 hover:bg-accent/50"
                    onClick={() => toggleLabel(label.id)}
                  >
                    <Checkbox
                      checked={draftLabelIds.includes(label.id)}
                      className="pointer-events-none"
                    />
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: label.color }}
                    />
                    <Label className="flex-1 cursor-pointer text-sm font-normal">{label.name}</Label>
                    <button
                      type="button"
                      onClick={(e) => void handleDeleteLabel(label, e)}
                      className="shrink-0 cursor-pointer rounded-sm p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={`Delete label ${label.name}`}
                    >
                      <TrashIcon className="size-3.5" />
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="New label name…"
                className="h-8 border-border-table text-sm shadow-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleCreateLabel()
                  }
                }}
              />
              <div className="flex shrink-0 items-center gap-1">
                {TASK_LABEL_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setNewLabelColor(color)}
                    className={cn(
                      'size-5 cursor-pointer rounded-full border-2 transition-transform',
                      newLabelColor === color ? 'scale-110 border-foreground' : 'border-transparent',
                    )}
                    style={{ backgroundColor: color }}
                    aria-label={`Color ${color}`}
                  />
                ))}
              </div>
            </div>

            {hasPendingNewLabel ? (
              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  disabled={isSaving}
                  onClick={() => void handleCreateLabel()}
                  className="h-8 cursor-pointer px-3 text-xs"
                >
                  {isSaving ? 'Adding…' : 'Add'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={isSaving}
                  onClick={cancel}
                  className="h-8 cursor-pointer px-3 text-xs"
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <FieldFormActions
                isSaving={isSaving}
                saveDisabled={!hasAssignmentChanges}
                onSave={() => void handleSave()}
                onCancel={cancel}
              />
            )}
          </div>
        ) : (
          <ClickableValue
            onClick={() => {
              resetDraft()
              setIsActive(true)
            }}
          >
            {task.labels && task.labels.length > 0 ? (
              <TaskLabelList labels={task.labels} max={10} />
            ) : (
              'No labels'
            )}
          </ClickableValue>
        )}
      </div>
    </PanelFormRow>
  )
}
