import { ArrowRightIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import {
  authArrowSubmitButtonClassName,
  authInputClassName,
} from '@/components/auth/auth-styles'
import { AuthTextLink } from '@/pages/auth/AuthLayout'

interface CreateWorkspaceFormProps {
  workspaceName: string
  workspaceSlug: string
  isLoading: boolean
  onWorkspaceNameChange: (name: string) => void
  onWorkspaceSlugChange: (slug: string) => void
  onSubmit: (e: React.FormEvent) => void
  onBack: () => void
}

export function CreateWorkspaceForm({
  workspaceName,
  workspaceSlug,
  isLoading,
  onWorkspaceNameChange,
  onWorkspaceSlugChange,
  onSubmit,
  onBack,
}: CreateWorkspaceFormProps) {
  const hasName = workspaceName.trim().length > 0
  const hasSlug = workspaceSlug.trim().length > 0
  const canSubmit = hasName && hasSlug

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Workspace details</p>
        <AuthTextLink onClick={onBack}>Back</AuthTextLink>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-3">
        <Input
          type="text"
          placeholder="Workspace name"
          value={workspaceName}
          onChange={(e) => onWorkspaceNameChange(e.target.value)}
          required
          disabled={isLoading}
          className={authInputClassName}
        />
        <div className="relative">
          <Input
            type="text"
            placeholder="Workspace URL (acme-inc)"
            value={workspaceSlug}
            onChange={(e) => onWorkspaceSlugChange(e.target.value)}
            required
            disabled={isLoading}
            className={cn(authInputClassName, canSubmit && 'pr-12')}
          />
          {canSubmit ? (
            <Button
              type="submit"
              variant="oauth"
              size="icon-sm"
              aria-label="Create workspace"
              disabled={isLoading}
              loading={isLoading}
              className={authArrowSubmitButtonClassName}
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          ) : null}
        </div>
        {hasName ? (
          <p className="text-xs text-muted-foreground">
            This will be used in your workspace URL
          </p>
        ) : null}
      </form>
    </div>
  )
}
