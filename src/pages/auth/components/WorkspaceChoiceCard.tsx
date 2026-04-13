import { Plus, LogIn } from 'lucide-react'

interface WorkspaceChoiceCardProps {
  onCreateWorkspace: () => void
  onJoinWorkspace: () => void
}

export function WorkspaceChoiceCard({ onCreateWorkspace, onJoinWorkspace }: WorkspaceChoiceCardProps) {
  return (
    <div className="space-y-3">
      <button
        onClick={onCreateWorkspace}
        className="flex w-full cursor-pointer items-start gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Plus className="size-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Create a workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Start fresh with a new workspace for your team
          </p>
        </div>
      </button>

      <button
        onClick={onJoinWorkspace}
        className="flex w-full cursor-pointer items-start gap-4 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-accent"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <LogIn className="size-4 text-primary" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold">Join a workspace</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Use an invite code to join an existing workspace
          </p>
        </div>
      </button>
    </div>
  )
}
