import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import type { TaskActivity, TaskComment } from '@/pages/tasks/types'

export async function getCommentCountsByTaskIds(
  taskIds: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  if (taskIds.length === 0) return result

  const { data, error } = await supabase
    .from('task_comments')
    .select('task_id')
    .in('task_id', taskIds)

  if (error) throw error

  for (const row of data ?? []) {
    result.set(row.task_id, (result.get(row.task_id) ?? 0) + 1)
  }

  return result
}

export async function getTaskComments(taskId: string): Promise<TaskComment[]> {
  const { data, error } = await supabase
    .from('task_comments')
    .select(`
      *,
      author:profiles!task_comments_author_id_fkey(id, full_name)
    `)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as TaskComment[]
}

export async function createTaskComment(
  taskId: string,
  workspaceId: string,
  authorId: string,
  body: string,
): Promise<TaskComment> {
  const trimmed = body.trim()
  if (!trimmed) throw new Error('Comment cannot be empty')

  const { data, error } = await supabase
    .from('task_comments')
    .insert({
      task_id: taskId,
      workspace_id: workspaceId,
      author_id: authorId,
      body: trimmed,
    })
    .select(`
      *,
      author:profiles!task_comments_author_id_fkey(id, full_name)
    `)
    .single()

  if (error) throw error
  return data as TaskComment
}

export async function getTaskActivities(taskId: string): Promise<TaskActivity[]> {
  const { data, error } = await supabase
    .from('task_activities')
    .select(`
      *,
      actor:profiles!task_activities_actor_id_fkey(id, full_name)
    `)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as TaskActivity[]
}

export async function logFieldChangeActivity(input: {
  workspaceId: string
  taskId: string
  actorId: string
  activityType: 'status_changed' | 'priority_changed' | 'assignee_changed' | 'due_date_changed'
  metadata: Record<string, unknown>
}): Promise<void> {
  const { error } = await supabase.from('task_activities').insert({
    workspace_id: input.workspaceId,
    task_id: input.taskId,
    actor_id: input.actorId,
    activity_type: input.activityType,
    metadata: input.metadata as Json,
  })

  if (error) throw error
}
