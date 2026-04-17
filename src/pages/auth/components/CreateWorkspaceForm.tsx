import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircleIcon, BuildingIcon, HashIcon } from '@/components/icons'

interface CreateWorkspaceFormProps {
  workspaceName: string
  workspaceSlug: string
  error: string
  isLoading: boolean
  onWorkspaceNameChange: (name: string) => void
  onWorkspaceSlugChange: (slug: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}

export function CreateWorkspaceForm({
  workspaceName,
  workspaceSlug,
  error,
  isLoading,
  onWorkspaceNameChange,
  onWorkspaceSlugChange,
  onSubmit,
  onBack,
}: CreateWorkspaceFormProps) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {/* Error Message */}
      {error && (
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Workspace Name */}
      <div className="space-y-2">
        <Label htmlFor="workspace-name" className="cursor-pointer">
          Workspace name
        </Label>
        <div className="relative">
          <BuildingIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="workspace-name"
            type="text"
            placeholder="Acme Inc"
            value={workspaceName}
            onChange={(e) => onWorkspaceNameChange(e.target.value)}
            className="pl-10"
            required
          />
        </div>
      </div>

      {/* Workspace Slug - Only show if name is entered */}
      {workspaceName && (
        <div className="space-y-2">
          <Label htmlFor="workspace-slug" className="cursor-pointer">
            Workspace URL
          </Label>
          <div className="relative">
            <HashIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="workspace-slug"
              type="text"
              placeholder="acme-inc"
              value={workspaceSlug}
              onChange={(e) => onWorkspaceSlugChange(e.target.value)}
              className="pl-10"
              required
            />
          </div>
          <p className="text-xs text-muted-foreground">
            This will be used in your workspace URL
          </p>
        </div>
      )}

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
          disabled={isLoading || !workspaceName}
        >
          {isLoading ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              Creating...
            </span>
          ) : workspaceName && workspaceSlug ? (
            'Create workspace'
          ) : (
            'Continue'
          )}
        </Button>
      </div>
    </form>
  )
}
