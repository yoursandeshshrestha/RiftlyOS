import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

export type TimeEntry = Database['public']['Tables']['time_entries']['Row']
export type TimeEntrySource = Database['public']['Enums']['time_entry_source']

export interface TimeEntryWithUser extends TimeEntry {
  user?: { full_name: string } | null
}

export interface RunningTimer extends TimeEntry {
  task?: { id: string; title: string } | null
}

export async function getTimeEntriesForTask(taskId: string): Promise<TimeEntryWithUser[]> {
  const { data, error } = await supabase
    .from('time_entries')
    .select(`
      *,
      user:profiles!time_entries_user_id_fkey(full_name)
    `)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as TimeEntryWithUser[]
}

export async function getRunningTimerForUser(
  userId: string,
  workspaceId: string,
): Promise<RunningTimer | null> {
  const { data, error } = await supabase
    .from('time_entries')
    .select(`
      *,
      task:tasks!time_entries_task_id_fkey(id, title)
    `)
    .eq('user_id', userId)
    .eq('workspace_id', workspaceId)
    .is('minutes', null)
    .not('started_at', 'is', null)
    .maybeSingle()

  if (error) throw error
  return data as RunningTimer | null
}

export async function startTimer(input: {
  taskId: string
  workspaceId: string
  userId: string
  billable?: boolean
  description?: string
}): Promise<void> {
  const existing = await getRunningTimerForUser(input.userId, input.workspaceId)
  if (existing && existing.task_id !== input.taskId) {
    throw new Error(
      `You already have a timer running on "${existing.task?.title ?? 'another task'}". Stop it first.`,
    )
  }
  if (existing && existing.task_id === input.taskId) {
    return
  }

  const { error } = await supabase.from('time_entries').insert({
    workspace_id: input.workspaceId,
    task_id: input.taskId,
    user_id: input.userId,
    minutes: null,
    billable: input.billable ?? true,
    description: input.description ?? null,
    source: 'timer',
    started_at: new Date().toISOString(),
  })

  if (error) throw error
}

export async function stopTimer(taskId: string, userId: string): Promise<void> {
  const { data: entries, error: fetchError } = await supabase
    .from('time_entries')
    .select('*')
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .is('minutes', null)
    .not('started_at', 'is', null)

  if (fetchError) throw fetchError

  const open = entries?.[0]
  if (!open?.started_at) throw new Error('No running timer')

  const endedAt = new Date()
  const minutes = Math.max(1, Math.round((endedAt.getTime() - new Date(open.started_at).getTime()) / 60000))

  const { error } = await supabase
    .from('time_entries')
    .update({ minutes, ended_at: endedAt.toISOString() })
    .eq('id', open.id)

  if (error) throw error
}

export async function addManualTime(input: {
  taskId: string
  workspaceId: string
  userId: string
  minutes: number
  billable: boolean
  description?: string
}): Promise<void> {
  if (input.minutes <= 0) throw new Error('Time must be greater than zero')

  const { error } = await supabase.from('time_entries').insert({
    workspace_id: input.workspaceId,
    task_id: input.taskId,
    user_id: input.userId,
    minutes: input.minutes,
    billable: input.billable,
    description: input.description ?? null,
    source: 'manual',
  })

  if (error) throw error
}

export async function deleteTimeEntry(entryId: string): Promise<void> {
  const { error } = await supabase.from('time_entries').delete().eq('id', entryId)
  if (error) throw error
}

/** Add or remove logged minutes for a user on a task (15m steps typical). */
export async function adjustUserLoggedTime(
  taskId: string,
  userId: string,
  workspaceId: string,
  deltaMinutes: number,
  opts?: { billable?: boolean; description?: string },
): Promise<void> {
  if (deltaMinutes === 0) return

  if (deltaMinutes > 0) {
    await addManualTime({
      taskId,
      workspaceId,
      userId,
      minutes: deltaMinutes,
      billable: opts?.billable ?? true,
      description: opts?.description,
    })
    return
  }

  let remaining = Math.abs(deltaMinutes)
  const { data: entries, error } = await supabase
    .from('time_entries')
    .select('*')
    .eq('task_id', taskId)
    .eq('user_id', userId)
    .not('minutes', 'is', null)
    .order('created_at', { ascending: false })

  if (error) throw error
  if (!entries?.length) throw new Error('No time to remove')

  for (const entry of entries) {
    if (remaining <= 0) break
    const entryMinutes = entry.minutes ?? 0
    if (entryMinutes <= remaining) {
      await deleteTimeEntry(entry.id)
      remaining -= entryMinutes
    } else {
      const { error: updateError } = await supabase
        .from('time_entries')
        .update({ minutes: entryMinutes - remaining })
        .eq('id', entry.id)
      if (updateError) throw updateError
      remaining = 0
    }
  }

  if (remaining > 0) throw new Error('Cannot remove more time than logged')
}

export function getUserLoggedMinutes(
  entries: TimeEntry[],
  userId: string,
  now = Date.now(),
): number {
  return entries
    .filter((e) => e.user_id === userId)
    .reduce((sum, e) => {
      if (e.minutes !== null) return sum + e.minutes
      if (e.started_at) {
        return sum + Math.max(0, Math.round((now - new Date(e.started_at).getTime()) / 60000))
      }
      return sum
    }, 0)
}

export function getUserRemovableMinutes(entries: TimeEntry[], userId: string): number {
  return entries
    .filter((e) => e.user_id === userId && e.minutes !== null)
    .reduce((sum, e) => sum + (e.minutes ?? 0), 0)
}

export interface UserTimeSummary {
  userId: string
  fullName: string
  totalMinutes: number
  hasRunningTimer: boolean
  runningStartedAt: string | null
}

export function sumLoggedMinutes(entries: TimeEntry[], now = Date.now()): number {
  return entries.reduce((sum, e) => {
    if (e.minutes !== null) return sum + e.minutes
    if (e.started_at) {
      return sum + Math.max(0, Math.round((now - new Date(e.started_at).getTime()) / 60000))
    }
    return sum
  }, 0)
}

export async function getLoggedMinutesByTaskIds(
  taskIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (taskIds.length === 0) return result

  const { data, error } = await supabase
    .from('time_entries')
    .select('task_id, minutes, started_at')
    .in('task_id', taskIds)

  if (error) throw error

  const byTask = new Map<string, TimeEntry[]>()
  for (const entry of data ?? []) {
    const list = byTask.get(entry.task_id) ?? []
    list.push(entry as TimeEntry)
    byTask.set(entry.task_id, list)
  }

  const now = Date.now()
  for (const [taskId, entries] of byTask) {
    result.set(taskId, sumLoggedMinutes(entries, now))
  }

  return result
}

export function getRunningEntry(entries: TimeEntry[], userId: string): TimeEntry | undefined {
  return entries.find((e) => e.user_id === userId && e.minutes === null && e.started_at !== null)
}

export function groupTimeByUser(
  entries: TimeEntryWithUser[],
  now = Date.now(),
): UserTimeSummary[] {
  const map = new Map<string, UserTimeSummary>()

  for (const entry of entries) {
    const existing = map.get(entry.user_id) ?? {
      userId: entry.user_id,
      fullName: entry.user?.full_name ?? 'Unknown',
      totalMinutes: 0,
      hasRunningTimer: false,
      runningStartedAt: null,
    }

    if (entry.minutes === null && entry.started_at) {
      existing.hasRunningTimer = true
      existing.runningStartedAt = entry.started_at
      existing.totalMinutes += Math.max(
        0,
        Math.round((now - new Date(entry.started_at).getTime()) / 60000),
      )
    } else if (entry.minutes != null) {
      existing.totalMinutes += entry.minutes
    }

    map.set(entry.user_id, existing)
  }

  return Array.from(map.values()).sort((a, b) => a.fullName.localeCompare(b.fullName))
}
