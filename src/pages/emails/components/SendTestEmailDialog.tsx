import { useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SendIcon } from '@/components/icons'
import { queueEmail } from '@/lib/email'
import { toast } from 'sonner'

interface SendTestEmailDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  workspaceName: string
  defaultRecipient?: string
  onSent?: () => void
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
}

export function SendTestEmailDialog({
  open,
  onOpenChange,
  workspaceId,
  workspaceName,
  defaultRecipient = '',
  onSent,
}: SendTestEmailDialogProps) {
  const [recipient, setRecipient] = useState(defaultRecipient)
  const [isSending, setIsSending] = useState(false)

  useEffect(() => {
    if (open) {
      setRecipient(defaultRecipient)
    }
  }, [open, defaultRecipient])

  const canSend = isValidEmail(recipient)

  const handleSend = async () => {
    if (!canSend) return

    setIsSending(true)
    try {
      const result = await queueEmail(
        'test-email',
        recipient.trim(),
        {
          workspaceName,
          sentAt: new Date().toISOString(),
        },
        { workspaceId },
      )

      if (!result.queued) {
        toast.error(result.error ?? 'Failed to send test email')
        return
      }

      toast.success('Test email queued — check the deliveries table for status')
      onOpenChange(false)
      onSent?.()
    } catch (error) {
      console.error('Test email failed:', error)
      toast.error('Failed to send test email')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-4 sm:max-w-md">
        <DialogHeader className="gap-1">
          <DialogTitle>Send test email</DialogTitle>
          <DialogDescription>
            Send a test message to any address to verify outbound email is working.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="test-email-recipient">Recipient email</Label>
          <Input
            id="test-email-recipient"
            type="email"
            placeholder="you@example.com"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            autoComplete="email"
          />
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={() => onOpenChange(false)}
            disabled={isSending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            onClick={() => void handleSend()}
            disabled={!canSend || isSending}
          >
            <SendIcon className="size-4" />
            {isSending ? 'Sending…' : 'Send test'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
