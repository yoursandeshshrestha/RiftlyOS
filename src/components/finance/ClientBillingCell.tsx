import { TableCell } from '@/components/ui/table'

interface ClientBillingCellProps {
  clientName: string | null
  profileEmail: string | null
  billingEmail: string | null
  className?: string
}

export function ClientBillingCell({
  clientName,
  profileEmail,
  billingEmail,
  className,
}: ClientBillingCellProps) {
  const billTo = billingEmail ?? profileEmail
  const showAccountEmail =
    billingEmail && profileEmail && billingEmail.toLowerCase() !== profileEmail.toLowerCase()

  return (
    <TableCell className={className}>
      <div className="font-medium">{clientName ?? '—'}</div>
      {billTo ? (
        <div className="text-xs text-muted-foreground">
          {billingEmail ? (
            <>
              <span className="text-muted-foreground/80">Bill to: </span>
              {billingEmail}
            </>
          ) : (
            profileEmail
          )}
        </div>
      ) : null}
      {showAccountEmail ? (
        <div className="text-xs text-muted-foreground/80">Account: {profileEmail}</div>
      ) : null}
    </TableCell>
  )
}
