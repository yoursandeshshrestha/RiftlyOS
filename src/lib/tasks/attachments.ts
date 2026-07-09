import { supabase } from '@/lib/supabase'
import type { TaskAttachment } from '@/pages/tasks/types'

const BUCKET = 'task-attachments'

export async function getTaskAttachments(taskId: string): Promise<TaskAttachment[]> {
  const { data, error } = await supabase
    .from('task_attachments')
    .select(`
      *,
      uploader:profiles!task_attachments_uploaded_by_fkey(id, full_name)
    `)
    .eq('task_id', taskId)
    .order('created_at', { ascending: true })

  if (error) throw error
  return (data ?? []) as TaskAttachment[]
}

export async function uploadTaskAttachment(input: {
  taskId: string
  workspaceId: string
  userId: string
  file: File
}): Promise<TaskAttachment> {
  const ext = input.file.name.includes('.')
    ? input.file.name.slice(input.file.name.lastIndexOf('.'))
    : ''
  const storagePath = `${input.workspaceId}/${input.taskId}/${crypto.randomUUID()}${ext}`

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, input.file, {
      contentType: input.file.type || undefined,
      upsert: false,
    })

  if (uploadError) throw uploadError

  const { data, error } = await supabase
    .from('task_attachments')
    .insert({
      workspace_id: input.workspaceId,
      task_id: input.taskId,
      uploaded_by: input.userId,
      file_name: input.file.name,
      storage_path: storagePath,
      file_size: input.file.size,
      mime_type: input.file.type || null,
    })
    .select(`
      *,
      uploader:profiles!task_attachments_uploaded_by_fkey(id, full_name)
    `)
    .single()

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath])
    throw error
  }

  return data as TaskAttachment
}

export async function deleteTaskAttachment(attachment: TaskAttachment): Promise<void> {
  const { error: dbError } = await supabase
    .from('task_attachments')
    .delete()
    .eq('id', attachment.id)

  if (dbError) throw dbError

  await supabase.storage.from(BUCKET).remove([attachment.storage_path])
}

export async function getAttachmentDownloadUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 3600)

  if (error) throw error
  return data.signedUrl
}

export function formatFileSize(bytes: number | null): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
