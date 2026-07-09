import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/contexts/AuthContext'
import { cn } from '@/lib/utils'
import { useClickOutside } from '@/hooks/useClickOutside'
import { createTaskComment } from '@/lib/tasks/comments'
import { taskPanelSubsectionClass } from './taskPanelStyles'

interface TaskCommentComposerProps {
  taskId: string
  workspaceId: string
  onPosted: () => void
}

export function TaskCommentComposer({
  taskId,
  workspaceId,
  onPosted,
}: TaskCommentComposerProps) {
  const { user } = useAuth()
  const [isActive, setIsActive] = useState(false)
  const [draft, setDraft] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const composerRef = useRef<HTMLDivElement>(null)

  const collapse = () => {
    if (!draft.trim()) setIsActive(false)
  }

  useClickOutside(composerRef, collapse, isActive)

  const handleSubmit = async () => {
    if (!user?.id || !draft.trim()) return

    setIsSubmitting(true)
    try {
      await createTaskComment(taskId, workspaceId, user.id, draft)
      setDraft('')
      setIsActive(false)
      onPosted()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to post comment')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      ref={composerRef}
      className={cn(
        'shrink-0 px-4 py-3',
        taskPanelSubsectionClass,
      )}
    >
      {!isActive ? (
        <button
          type="button"
          onClick={() => setIsActive(true)}
          className={cn(
            'flex h-9 w-full cursor-pointer items-center rounded-lg border border-border-table/50',
            'bg-background/80 px-3 text-left text-sm text-muted-foreground',
            'transition-colors hover:bg-background hover:text-foreground',
          )}
        >
          Leave a comment…
        </button>
      ) : (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a comment…"
            rows={3}
            autoFocus
            className="min-h-20 resize-none rounded-lg border-border-table/50 bg-background text-sm shadow-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                void handleSubmit()
              }
              if (e.key === 'Escape') {
                setDraft('')
                setIsActive(false)
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={isSubmitting}
              onClick={() => {
                setDraft('')
                setIsActive(false)
              }}
              className="h-8 cursor-pointer px-3 text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isSubmitting || !draft.trim()}
              onClick={() => void handleSubmit()}
              className="h-8 cursor-pointer px-3 text-xs"
            >
              {isSubmitting ? 'Posting…' : 'Comment'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
