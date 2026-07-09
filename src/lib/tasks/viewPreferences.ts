import { supabase } from '@/lib/supabase'
import type { Json } from '@/lib/database.types'
import {
  normalizeTaskViewSettings,
  type TaskViewSettings,
} from '@/pages/tasks/taskViewSettings'

export async function loadTaskViewPreferences(
  workspaceId: string,
  userId: string,
): Promise<TaskViewSettings | null> {
  const { data, error } = await supabase
    .from('user_task_view_preferences')
    .select('settings')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  if (!data?.settings) return null
  return normalizeTaskViewSettings(data.settings)
}

export async function saveTaskViewPreferences(
  workspaceId: string,
  userId: string,
  settings: TaskViewSettings,
): Promise<void> {
  const { error } = await supabase.from('user_task_view_preferences').upsert(
    {
      user_id: userId,
      workspace_id: workspaceId,
      settings: settings as unknown as Json,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,workspace_id' },
  )

  if (error) throw error
}
