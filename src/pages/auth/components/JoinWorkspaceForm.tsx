import { ArrowRightIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  authArrowSubmitButtonClassName,
  authInputClassName,
} from '@/components/auth/auth-styles'
import { AuthTextLink } from '@/pages/auth/AuthLayout'

interface JoinWorkspaceFormProps {
  inviteCode: string
  isLoading: boolean
  onInviteCodeChange: (code: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}

export function JoinWorkspaceForm({
  inviteCode,
  isLoading,
  onInviteCodeChange,
  onSubmit,
  onBack,
}: JoinWorkspaceFormProps) {
  const canSubmit = inviteCode.trim().length > 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Invite code</p>
        <AuthTextLink onClick={onBack}>Back</AuthTextLink>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <div className="relative">
          <Input
            type="text"
            placeholder="Enter invite code"
            value={inviteCode}
            onChange={(e) => onInviteCodeChange(e.target.value)}
            required
            disabled={isLoading}
            className={cn(authInputClassName, canSubmit && 'pr-12')}
          />
          {canSubmit ? (
            <Button
              type="submit"
              variant="oauth"
              size="icon-sm"
              aria-label="Join workspace"
              disabled={isLoading}
              loading={isLoading}
              className={authArrowSubmitButtonClassName}
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          ) : null}
        </div>
      </form>
    </div>
  )
}
