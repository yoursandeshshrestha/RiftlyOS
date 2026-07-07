import { Button } from '@/components/ui/button'
import { PlusIcon, LoginIcon } from '@/components/icons'
import { authChoiceButtonClassName } from '@/components/auth/auth-styles'

interface WorkspaceChoiceCardProps {
  onCreateWorkspace: () => void
  onJoinWorkspace: () => void
}

export function WorkspaceChoiceCard({
  onCreateWorkspace,
  onJoinWorkspace,
}: WorkspaceChoiceCardProps) {
  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        variant="oauth"
        onClick={onCreateWorkspace}
        className={authChoiceButtonClassName}
      >
        <PlusIcon className="size-4 shrink-0" />
        <span className="flex flex-col items-start gap-0.5">
          <span className="font-medium">Create a workspace</span>
          <span className="text-xs font-normal text-muted-foreground">
            Start fresh with a new workspace for your team
          </span>
        </span>
      </Button>

      <Button
        type="button"
        variant="oauth"
        onClick={onJoinWorkspace}
        className={authChoiceButtonClassName}
      >
        <LoginIcon className="size-4 shrink-0" />
        <span className="flex flex-col items-start gap-0.5">
          <span className="font-medium">Join a workspace</span>
          <span className="text-xs font-normal text-muted-foreground">
            Use an invite code to join an existing workspace
          </span>
        </span>
      </Button>
    </div>
  )
}
