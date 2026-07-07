import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircleIcon, HashIcon } from '@/components/icons'

interface JoinWorkspaceFormProps {
  inviteCode: string
  error: string
  isLoading: boolean
  onInviteCodeChange: (code: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}

export function JoinWorkspaceForm({
  inviteCode,
  error,
  isLoading,
  onInviteCodeChange,
  onSubmit,
  onBack,
}: JoinWorkspaceFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Invite Code */}
      <div className="space-y-2">
        <Label htmlFor="invite-code" className="cursor-pointer">
          Invite code
        </Label>
        <div className="relative">
          <HashIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="invite-code"
            type="text"
            placeholder="riftly2024"
            value={inviteCode}
            onChange={(e) => onInviteCodeChange(e.target.value)}
            className="pl-10"
            required
          />
        </div>
      </div>

      {/* Buttons */}
      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          className="cursor-pointer"
          disabled={isLoading}
        >
          Back
        </Button>
        <Button
          type="submit"
          className="flex-1 cursor-pointer"
          loading={isLoading}
          disabled={!inviteCode}
        >
          {isLoading ? 'Joining...' : 'Join workspace'}
        </Button>
      </div>
    </form>
  )
}
