import { supabase } from '@/lib/supabase'
import type { TaskLabel } from '@/pages/tasks/types'

export async function getWorkspaceLabels(workspaceId: string): Promise<TaskLabel[]> {
  const { data, error } = await supabase
    .from('task_labels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name')

  if (error) throw error
  return (data ?? []) as TaskLabel[]
}

export async function createLabel(
  workspaceId: string,
  name: string,
  color: string,
): Promise<TaskLabel> {
  const { data, error } = await supabase
    .from('task_labels')
    .insert({ workspace_id: workspaceId, name: name.trim(), color })
    .select()
    .single()

  if (error) throw error
  return data as TaskLabel
}

export async function deleteLabel(labelId: string): Promise<void> {
  const { error } = await supabase.from('task_labels').delete().eq('id', labelId)
  if (error) throw error
}

export async function getTaskLabelIds(taskId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('task_label_assignments')
    .select('label_id')
    .eq('task_id', taskId)

  if (error) throw error
  return (data ?? []).map((row) => row.label_id)
}

export async function setTaskLabels(
  taskId: string,
  workspaceId: string,
  actorId: string,
  previousLabelIds: string[],
  nextLabelIds: string[],
): Promise<void> {
  const prev = new Set(previousLabelIds)
  const next = new Set(nextLabelIds)

  const toAdd = nextLabelIds.filter((id) => !prev.has(id))
  const toRemove = previousLabelIds.filter((id) => !next.has(id))

  if (toAdd.length === 0 && toRemove.length === 0) return

  if (toRemove.length > 0) {
    const { error } = await supabase
      .from('task_label_assignments')
      .delete()
      .eq('task_id', taskId)
      .in('label_id', toRemove)

    if (error) throw error
  }

  if (toAdd.length > 0) {
    const { error } = await supabase.from('task_label_assignments').insert(
      toAdd.map((labelId) => ({ task_id: taskId, label_id: labelId })),
    )

    if (error) throw error
  }

  const labelIds = [...new Set([...toAdd, ...toRemove])]
  if (labelIds.length === 0) return

  const { data: labels } = await supabase
    .from('task_labels')
    .select('id, name, color')
    .in('id', labelIds)

  const labelMap = new Map((labels ?? []).map((l) => [l.id, l]))

  const activities = [
    ...toAdd.map((labelId) => ({
      workspace_id: workspaceId,
      task_id: taskId,
      actor_id: actorId,
      activity_type: 'label_added' as const,
      metadata: {
        label_id: labelId,
        label_name: labelMap.get(labelId)?.name ?? '',
        label_color: labelMap.get(labelId)?.color ?? '#6366f1',
      },
    })),
    ...toRemove.map((labelId) => ({
      workspace_id: workspaceId,
      task_id: taskId,
      actor_id: actorId,
      activity_type: 'label_removed' as const,
      metadata: {
        label_id: labelId,
        label_name: labelMap.get(labelId)?.name ?? '',
        label_color: labelMap.get(labelId)?.color ?? '#6366f1',
      },
    })),
  ]

  if (activities.length > 0) {
    const { error } = await supabase.from('task_activities').insert(activities)
    if (error) throw error
  }
}

export async function fetchLabelsForTasks(
  taskIds: string[],
): Promise<Map<string, TaskLabel[]>> {
  const result = new Map<string, TaskLabel[]>()
  if (taskIds.length === 0) return result

  const { data, error } = await supabase
    .from('task_label_assignments')
    .select('task_id, label:task_labels(id, workspace_id, name, color, created_at)')
    .in('task_id', taskIds)

  if (error) throw error

  for (const row of data ?? []) {
    const label = row.label as TaskLabel | null
    if (!label) continue
    const existing = result.get(row.task_id) ?? []
    existing.push(label)
    result.set(row.task_id, existing)
  }

  return result
}
