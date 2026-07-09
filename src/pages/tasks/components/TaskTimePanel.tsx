import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Textarea } from '@/components/ui/textarea'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CalendarIcon } from '@/components/icons'
import { PanelFormRow } from '@/components/layout/PanelFormRow'
import { useAuth } from '@/contexts/AuthContext'
import { supabase } from '@/lib/supabase'
import { formatDateShort } from '@/lib/date'
import {
  adjustUserLoggedTime,
  getRunningEntry,
  getTimeEntriesForTask,
  getUserRemovableMinutes,
  groupTimeByUser,
  startTimer,
  stopTimer,
  sumLoggedMinutes,
  type TimeEntryWithUser,
} from '@/lib/time/entries'
import { formatDuration, formatElapsedClock, formatEstimate, parseDurationInput } from '@/lib/time/format'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/hooks/useClickOutside'

interface TaskTimePanelProps {
  taskId: string
  workspaceId: string
  initialEstimateMinutes?: number | null
  onEstimateChange?: (minutes: number) => void
  onTimerChange?: () => void
}

const STEP_MINUTES = 15

type EditingField = 'time' | 'estimate' | null

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function TaskTimePanel({
  taskId,
  workspaceId,
  initialEstimateMinutes,
  onEstimateChange,
  onTimerChange,
}: TaskTimePanelProps) {
  const { user } = useAuth()
  const [entries, setEntries] = useState<TimeEntryWithUser[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [editingField, setEditingField] = useState<EditingField>(null)
  const [estimateMinutes, setEstimateMinutes] = useState(initialEstimateMinutes ?? 0)
  const [draftEstimateMinutes, setDraftEstimateMinutes] = useState(initialEstimateMinutes ?? 0)
  const [draftTotalMinutes, setDraftTotalMinutes] = useState(0)
  const [savedTotalAtOpen, setSavedTotalAtOpen] = useState(0)
  const [inlineNotes, setInlineNotes] = useState('')
  const [entryDate, setEntryDate] = useState<Date>(new Date())
  const [showCalendar, setShowCalendar] = useState(false)
  const [tick, setTick] = useState(0)
  const activeEditorRef = useRef<HTMLDivElement>(null)

  const handleCancelTime = useCallback(() => {
    setDraftTotalMinutes(savedTotalAtOpen)
    setInlineNotes('')
    setEntryDate(new Date())
    setEditingField(null)
    setShowCalendar(false)
  }, [savedTotalAtOpen])

  const handleCancelEstimate = useCallback(() => {
    setDraftEstimateMinutes(estimateMinutes)
    setEditingField(null)
  }, [estimateMinutes])

  useClickOutside(
    activeEditorRef,
    () => {
      if (showCalendar) {
        setShowCalendar(false)
        return
      }
      if (editingField === 'time') handleCancelTime()
      else if (editingField === 'estimate') handleCancelEstimate()
    },
    editingField !== null || showCalendar,
  )

  const runningEntry = user ? getRunningEntry(entries, user.id) : undefined
  void tick
  const totalMinutes = sumLoggedMinutes(entries)
  const hasAnyRunning = entries.some((e) => e.minutes === null && e.started_at)
  const userRemovableMinutes = user ? getUserRemovableMinutes(entries, user.id) : 0

  const minDraftTotal = Math.max(0, savedTotalAtOpen - userRemovableMinutes)
  const canDecreaseDraft = draftTotalMinutes - STEP_MINUTES >= minDraftTotal

  const loadEntries = useCallback(async () => {
    try {
      const data = await getTimeEntriesForTask(taskId)
      setEntries(data)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load time entries')
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    setIsLoading(true)
    loadEntries()
  }, [loadEntries])

  useEffect(() => {
    const estimate = initialEstimateMinutes ?? 0
    setEstimateMinutes(estimate)
    setDraftEstimateMinutes(estimate)
  }, [taskId, initialEstimateMinutes])

  useEffect(() => {
    if (!hasAnyRunning) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [hasAnyRunning])

  const userSummaries = useMemo(() => {
    void tick
    const grouped = groupTimeByUser(entries)

    if (user && !grouped.some((g) => g.userId === user.id)) {
      grouped.unshift({
        userId: user.id,
        fullName: user.name,
        totalMinutes: 0,
        hasRunningTimer: false,
        runningStartedAt: null,
      })
    }

    if (user) {
      const current = grouped.find((g) => g.userId === user.id)
      const rest = grouped.filter((g) => g.userId !== user.id)
      return current ? [current, ...rest] : grouped
    }

    return grouped
  }, [entries, tick, user])

  const notifyTimerChange = () => {
    onTimerChange?.()
    window.dispatchEvent(new CustomEvent('time-entry-changed'))
  }

  const resetTimeDraft = () => {
    setDraftTotalMinutes(0)
    setSavedTotalAtOpen(0)
    setInlineNotes('')
    setEntryDate(new Date())
  }

  const openTimeEditor = () => {
    setSavedTotalAtOpen(totalMinutes)
    setDraftTotalMinutes(totalMinutes)
    setInlineNotes('')
    setEntryDate(new Date())
    setEditingField('time')
  }

  const openEstimateEditor = () => {
    setDraftEstimateMinutes(estimateMinutes)
    setEditingField('estimate')
  }

  const handleStart = async () => {
    if (!user) return
    setIsSubmitting(true)
    try {
      await startTimer({ taskId, workspaceId, userId: user.id })
      await loadEntries()
      notifyTimerChange()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start timer')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleStop = async () => {
    if (!user) return
    setIsSubmitting(true)
    try {
      await stopTimer(taskId, user.id)
      await loadEntries()
      notifyTimerChange()
      toast.success('Timer stopped')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop timer')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveTime = async () => {
    if (!user) return
    const delta = draftTotalMinutes - savedTotalAtOpen
    if (delta === 0) {
      toast.error('Adjust time before saving')
      return
    }

    setIsSubmitting(true)
    try {
      await adjustUserLoggedTime(taskId, user.id, workspaceId, delta, {
        description: inlineNotes.trim() || undefined,
      })
      await loadEntries()
      notifyTimerChange()
      toast.success('Time saved')
      resetTimeDraft()
      setEditingField(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save time')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSaveEstimate = async () => {
    setIsSubmitting(true)
    try {
      const value = draftEstimateMinutes > 0 ? draftEstimateMinutes : null
      const { error } = await supabase
        .from('tasks')
        .update({ estimated_minutes: value })
        .eq('id', taskId)

      if (error) throw error

      setEstimateMinutes(draftEstimateMinutes)
      onEstimateChange?.(draftEstimateMinutes)
      setEditingField(null)
      toast.success('Estimate saved')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save estimate')
    } finally {
      setIsSubmitting(false)
    }
  }

  const toggleField = (field: 'time' | 'estimate') => {
    if (editingField === field) {
      if (field === 'time') handleCancelTime()
      else handleCancelEstimate()
      return
    }
    if (field === 'time') openTimeEditor()
    else openEstimateEditor()
  }

  const isToday =
    format(entryDate, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd')

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading time…</p>
  }

  return (
    <div className="space-y-0">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
        <EditableInfoLine
          label="Time"
          displayValue={formatDuration(
            editingField === 'time' ? draftTotalMinutes : totalMinutes,
          )}
          isActive={editingField === 'time'}
          onToggle={() => toggleField('time')}
        />
        <EditableInfoLine
          label="Estimate"
          displayValue={formatEstimate(
            editingField === 'estimate' ? draftEstimateMinutes : estimateMinutes,
          )}
          isActive={editingField === 'estimate'}
          onToggle={() => toggleField('estimate')}
        />
      </div>

      {editingField === 'time' && user && (
        <div ref={activeEditorRef} className="mt-3 space-y-2 border-t border-border-table pt-3">
          <PanelFormRow label="User">{user.name}</PanelFormRow>

          <PanelFormRow label="Time">
            <div className="flex flex-wrap items-center gap-2">
              <DraftStepper
                minutes={draftTotalMinutes}
                minMinutes={minDraftTotal}
                formatValue={formatDuration}
                disabled={isSubmitting}
                canDecrease={canDecreaseDraft}
                onChange={setDraftTotalMinutes}
                onStepDown={() =>
                  setDraftTotalMinutes((d) => Math.max(minDraftTotal, d - STEP_MINUTES))
                }
                onStepUp={() => setDraftTotalMinutes((d) => d + STEP_MINUTES)}
              />
              <Popover open={showCalendar} onOpenChange={setShowCalendar}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-sm border border-border-table bg-background px-2.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <CalendarIcon className="size-3.5" />
                    {isToday ? 'Today' : formatDateShort(entryDate)}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="single"
                    selected={entryDate}
                    onSelect={(d) => {
                      if (d) setEntryDate(d)
                      setShowCalendar(false)
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </PanelFormRow>

          <PanelFormRow label="Notes">
            <Textarea
              value={inlineNotes}
              onChange={(e) => setInlineNotes(e.target.value)}
              placeholder="Explain your progress…"
              rows={2}
              className="min-h-0 resize-y border-border-table bg-background text-sm shadow-none"
            />
          </PanelFormRow>

          <PanelFormActions
            isSubmitting={isSubmitting}
            saveDisabled={draftTotalMinutes === savedTotalAtOpen}
            onSave={handleSaveTime}
            onCancel={handleCancelTime}
          />
        </div>
      )}

      {editingField === 'estimate' && (
        <div ref={activeEditorRef} className="mt-3 space-y-2 border-t border-border-table pt-3">
          <PanelFormRow label="Estimate">
            <DraftStepper
              minutes={draftEstimateMinutes}
              minMinutes={0}
              formatValue={formatEstimate}
              disabled={isSubmitting}
              canDecrease={draftEstimateMinutes >= STEP_MINUTES}
              onChange={setDraftEstimateMinutes}
              onStepDown={() =>
                setDraftEstimateMinutes((m) => Math.max(0, m - STEP_MINUTES))
              }
              onStepUp={() => setDraftEstimateMinutes((m) => m + STEP_MINUTES)}
            />
          </PanelFormRow>

          <PanelFormActions
            isSubmitting={isSubmitting}
            saveDisabled={draftEstimateMinutes === estimateMinutes}
            onSave={handleSaveEstimate}
            onCancel={handleCancelEstimate}
          />
        </div>
      )}

      <div className="mt-3 space-y-3 border-t border-border-table pt-3">
        {userSummaries.map((summary) => {
          const isCurrentUser = summary.userId === user?.id

          return (
            <div
              key={summary.userId}
              className="flex items-center justify-between gap-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <Avatar className="size-7 shrink-0">
                  <AvatarFallback className="bg-violet-600 text-[10px] font-medium text-white">
                    {getInitials(summary.fullName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="truncate text-sm leading-snug text-foreground">
                    {summary.fullName}
                  </p>
                  <p className="text-sm leading-snug text-muted-foreground">
                    {summary.hasRunningTimer && summary.runningStartedAt ? (
                      <span className="text-green-600 dark:text-green-400">
                        {formatElapsedClock(summary.runningStartedAt)}
                        <span className="text-muted-foreground"> · running</span>
                      </span>
                    ) : (
                      formatDuration(summary.totalMinutes)
                    )}
                  </p>
                </div>
              </div>

              {isCurrentUser && (
                <div className="flex shrink-0 items-center gap-2">
                  {runningEntry ? (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={handleStop}
                      className="h-7 cursor-pointer px-2.5 text-xs"
                    >
                      Stop timer
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isSubmitting}
                      onClick={handleStart}
                      className="h-7 cursor-pointer border-green-600/40 px-2.5 text-xs text-green-700 hover:bg-green-600/10 dark:text-green-400"
                    >
                      Start timer
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isSubmitting}
                    onClick={openTimeEditor}
                    className="h-7 cursor-pointer px-2.5 text-xs"
                  >
                    Add Time
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PanelFormActions({
  isSubmitting,
  saveDisabled,
  onSave,
  onCancel,
}: {
  isSubmitting: boolean
  saveDisabled: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="flex items-center gap-2 pt-1 pl-[84px]">
      <Button
        type="button"
        size="sm"
        disabled={isSubmitting || saveDisabled}
        onClick={onSave}
        className="h-8 cursor-pointer px-3 text-xs"
      >
        {isSubmitting ? 'Saving…' : 'Save'}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={isSubmitting}
        onClick={onCancel}
        className="h-8 cursor-pointer px-2 text-xs text-muted-foreground"
      >
        Cancel
      </Button>
    </div>
  )
}

function DraftStepper({
  minutes,
  minMinutes,
  formatValue,
  canDecrease,
  disabled,
  onChange,
  onStepDown,
  onStepUp,
}: {
  minutes: number
  minMinutes: number
  formatValue: (totalMinutes: number) => string
  canDecrease: boolean
  disabled: boolean
  onChange: (minutes: number) => void
  onStepDown: () => void
  onStepUp: () => void
}) {
  const [text, setText] = useState(() => formatValue(minutes))
  const [isEditing, setIsEditing] = useState(false)

  useEffect(() => {
    if (!isEditing) {
      setText(formatValue(minutes))
    }
  }, [minutes, isEditing, formatValue])

  const applyParsedInput = (raw: string) => {
    const parsed = parseDurationInput(raw)
    if (parsed === null) return
    onChange(Math.max(minMinutes, parsed))
  }

  const commitInput = () => {
    const parsed = parseDurationInput(text)
    if (parsed === null) {
      setText(formatValue(minutes))
    } else {
      const clamped = Math.max(minMinutes, parsed)
      onChange(clamped)
      setText(formatValue(clamped))
    }
    setIsEditing(false)
  }

  return (
    <div className="inline-flex items-center border border-border-table bg-background">
      <StepControl
        label="Decrease"
        disabled={disabled || !canDecrease}
        onClick={() => {
          setIsEditing(false)
          onStepDown()
        }}
        className="border-r border-border-table"
      >
        −
      </StepControl>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onChange={(e) => {
          const next = e.target.value
          setText(next)
          setIsEditing(true)
          applyParsedInput(next)
        }}
        onFocus={() => setIsEditing(true)}
        onBlur={commitInput}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            commitInput()
          }
          if (e.key === 'Escape') {
            setText(formatValue(minutes))
            setIsEditing(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        className="h-7 w-20 border-0 bg-transparent px-2 text-center text-sm font-medium text-foreground outline-none focus:ring-0 disabled:opacity-50"
        aria-label="Time duration"
      />
      <StepControl
        label="Increase"
        disabled={disabled}
        onClick={() => {
          setIsEditing(false)
          onStepUp()
        }}
        className="border-l border-border-table"
      >
        +
      </StepControl>
    </div>
  )
}

function EditableInfoLine({
  label,
  displayValue,
  isActive,
  onToggle,
}: {
  label: string
  displayValue: string
  isActive: boolean
  onToggle: () => void
}) {
  return (
    <p className="text-sm leading-snug">
      <span className="text-muted-foreground">{label}: </span>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'cursor-pointer font-medium text-foreground transition-colors hover:text-foreground/80',
          isActive && 'text-foreground',
        )}
      >
        {displayValue}
      </button>
    </p>
  )
}

function StepControl({
  children,
  label,
  disabled,
  onClick,
  className,
}: {
  children: React.ReactNode
  label: string
  disabled?: boolean
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex size-7 cursor-pointer items-center justify-center text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40',
        className,
      )}
    >
      {children}
    </button>
  )
}
