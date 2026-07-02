import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { RefreshIcon } from '@/components/icons'
import { EmailStatusBadge } from './EmailStatusBadge'
import { EMAIL_TEMPLATE_LABELS, type EmailDelivery } from '../types'

interface EmailDetailsSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  delivery: EmailDelivery | null
  onRetry: (delivery: EmailDelivery) => void
  isRetrying: boolean
  formatDateTime: (value: string | null) => string
}

export function EmailDetailsSheet({
  open,
  onOpenChange,
  delivery,
  onRetry,
  isRetrying,
  formatDateTime,
}: EmailDetailsSheetProps) {
  if (!delivery) return null

  const canRetry = delivery.status === 'failed' || delivery.status === 'pending'
  const templateLabel = EMAIL_TEMPLATE_LABELS[delivery.template] ?? delivery.template

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{delivery.subject ?? delivery.recipient}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-6">
          <div>
            <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Status</p>
            <EmailStatusBadge status={delivery.status} />
          </div>

          <div className="rounded-xl border bg-muted p-3">
            <p className="text-xs text-muted-foreground dark:text-gray-400">Recipient</p>
            <p className="mt-1 text-sm font-semibold text-foreground dark:text-gray-100">
              {delivery.recipient}
            </p>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground dark:text-gray-300">
            <span>Template:</span>
            <span className="font-semibold text-foreground dark:text-gray-100">{templateLabel}</span>
          </div>

          {delivery.error_message && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
              <p className="text-xs font-medium text-muted-foreground dark:text-gray-400">
                Failure reason
              </p>
              <p className="mt-1 text-sm leading-relaxed text-red-700 dark:text-red-400">
                {delivery.error_message}
              </p>
            </div>
          )}

          <div className="rounded-xl border bg-muted p-4">
            <p className="text-xs font-medium text-muted-foreground dark:text-gray-400">Timeline</p>
            <div className="mt-3 space-y-2 text-sm">
              <TimelineRow label="Queued" value={formatDateTime(delivery.created_at)} />
              {delivery.sent_at && (
                <TimelineRow label="Sent" value={formatDateTime(delivery.sent_at)} />
              )}
              {delivery.last_retry_at && (
                <TimelineRow label="Last retry" value={formatDateTime(delivery.last_retry_at)} />
              )}
              <TimelineRow label="Retries" value={String(delivery.retry_count ?? 0)} />
            </div>
          </div>

          {delivery.resend_id && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Resend message ID</p>
              <p className="break-all font-mono text-xs text-foreground dark:text-gray-100">
                {delivery.resend_id}
              </p>
            </div>
          )}

          <div>
            <p className="mb-2 text-xs text-muted-foreground dark:text-gray-400">Payload</p>
            <pre className="max-h-48 overflow-auto rounded-xl border bg-muted p-3 text-xs leading-relaxed text-foreground dark:text-gray-100">
              {JSON.stringify(delivery.payload, null, 2)}
            </pre>
          </div>
        </div>

        {canRetry && (
          <SheetFooter className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1 cursor-pointer"
              disabled={isRetrying}
              onClick={() => onRetry(delivery)}
            >
              <RefreshIcon className="mr-2 size-4" />
              {isRetrying ? 'Retrying…' : 'Retry send'}
            </Button>
          </SheetFooter>
        )}
      </SheetContent>
    </Sheet>
  )
}

function TimelineRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground dark:text-gray-400">{label}</span>
      <span className="font-medium text-foreground dark:text-gray-100">{value}</span>
    </div>
  )
}
