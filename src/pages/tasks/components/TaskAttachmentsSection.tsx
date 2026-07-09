import { useCallback, useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { AttachmentIcon, DownloadIcon, TrashIcon, UploadIcon } from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { cn } from '@/lib/utils'
import {
  deleteTaskAttachment,
  formatFileSize,
  getAttachmentDownloadUrl,
  getTaskAttachments,
  uploadTaskAttachment,
} from '@/lib/tasks/attachments'
import type { TaskAttachment } from '../types'

export interface TaskAttachmentsSectionHandle {
  openUpload: () => void
  isUploading: boolean
}

interface TaskAttachmentsSectionProps {
  taskId: string
  workspaceId: string
  reloadKey?: number
  onActivityChange?: () => void
  onUploadingChange?: (isUploading: boolean) => void
  embedded?: boolean
  hideUploadButton?: boolean
}

export const TaskAttachmentsSection = forwardRef<
  TaskAttachmentsSectionHandle,
  TaskAttachmentsSectionProps
>(function TaskAttachmentsSection(
  {
    taskId,
    workspaceId,
    reloadKey = 0,
    onActivityChange,
    embedded = false,
    hideUploadButton = false,
    onUploadingChange,
  },
  ref,
) {
  const { user } = useAuth()
  const { userRole } = useWorkspace()
  const isStaff = userRole === 'owner' || userRole === 'employee'
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [attachments, setAttachments] = useState<TaskAttachment[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadAttachments = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await getTaskAttachments(taskId)
      setAttachments(data)
    } catch (err) {
      console.error('Failed to load attachments:', err)
    } finally {
      setIsLoading(false)
    }
  }, [taskId])

  useEffect(() => {
    void loadAttachments()
  }, [loadAttachments, reloadKey])

  useImperativeHandle(ref, () => ({
    openUpload: () => fileInputRef.current?.click(),
    isUploading,
  }))

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !user?.id) return

    setIsUploading(true)
    onUploadingChange?.(true)
    try {
      for (const file of Array.from(files)) {
        await uploadTaskAttachment({
          taskId,
          workspaceId,
          userId: user.id,
          file,
        })
      }
      await loadAttachments()
      onActivityChange?.()
      toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to upload file')
    } finally {
      setIsUploading(false)
      onUploadingChange?.(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDownload = async (attachment: TaskAttachment) => {
    try {
      const url = await getAttachmentDownloadUrl(attachment.storage_path)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to download file')
    }
  }

  const handleDelete = async (attachment: TaskAttachment) => {
    setDeletingId(attachment.id)
    try {
      await deleteTaskAttachment(attachment)
      setAttachments((prev) => prev.filter((a) => a.id !== attachment.id))
      onActivityChange?.()
      toast.success('Attachment removed')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete attachment')
    } finally {
      setDeletingId(null)
    }
  }

  const uploadInput = (
    <input
      ref={fileInputRef}
      type="file"
      multiple
      className="hidden"
      onChange={(e) => void handleUpload(e.target.files)}
    />
  )

  const uploadButton = !hideUploadButton && (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={isUploading}
      onClick={() => fileInputRef.current?.click()}
      className="h-8 cursor-pointer gap-1.5 px-2.5 text-xs"
    >
      <UploadIcon className="size-3.5" />
      {isUploading ? 'Uploading…' : 'Upload'}
    </Button>
  )

  const list = isLoading ? (
    <p className="text-sm text-muted-foreground">Loading…</p>
  ) : attachments.length === 0 ? (
    <p className="text-sm text-muted-foreground">No files attached.</p>
  ) : (
    <ul className="space-y-1">
      {attachments.map((attachment) => (
        <li
          key={attachment.id}
          className="flex items-center gap-2 rounded-sm px-1 py-1.5 hover:bg-background/50"
        >
          <AttachmentIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">{attachment.file_name}</p>
            <p className="text-xs text-muted-foreground">
              {formatFileSize(attachment.file_size)}
              {attachment.uploader?.full_name && ` · ${attachment.uploader.full_name}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => void handleDownload(attachment)}
              className="size-7 cursor-pointer"
              aria-label="Download"
            >
              <DownloadIcon className="size-3.5" />
            </Button>
            {(isStaff || attachment.uploaded_by === user?.id) && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                disabled={deletingId === attachment.id}
                onClick={() => void handleDelete(attachment)}
                className={cn(
                  'size-7 cursor-pointer text-destructive hover:text-destructive',
                  deletingId === attachment.id && 'opacity-60',
                )}
                aria-label="Delete attachment"
              >
                <TrashIcon className="size-3.5" />
              </Button>
            )}
          </div>
        </li>
      ))}
    </ul>
  )

  if (embedded) {
    return (
      <div>
        {uploadInput}
        {list}
      </div>
    )
  }

  return (
    <div className="border-t border-border-table px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">Attachments</p>
        {uploadButton}
        {uploadInput}
      </div>
      {list}
    </div>
  )
})
