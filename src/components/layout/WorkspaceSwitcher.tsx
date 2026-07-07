import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  PlusIcon,
  BuildingIcon,
  HashIcon,
  AlertCircleIcon,
  UploadIcon,
  CloseIcon,
  ChevronDownIcon,
  SettingsIcon,
  PanelLeftIcon,
} from '@/components/icons'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

function WorkspaceAvatar({
  name,
  logoUrl,
  size = 'md',
}: {
  name: string
  logoUrl?: string | null
  size?: 'sm' | 'md'
}) {
  const sizeClass = size === 'sm' ? 'size-5' : 'size-6'

  return (
    <Avatar className={cn(sizeClass, 'rounded-sm after:rounded-sm')}>
      {logoUrl ? (
        <img src={logoUrl} alt={name} className="size-full rounded-sm object-cover" />
      ) : (
        <AvatarFallback className="rounded-sm bg-sidebar-accent text-[9px] text-sidebar-accent-foreground">
          {name.substring(0, 2).toUpperCase()}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

interface WorkspaceSwitcherProps {
  isLoading?: boolean
  isCollapsed?: boolean
  onToggleCollapse?: () => void
}

export function WorkspaceSwitcher({ isLoading, isCollapsed, onToggleCollapse }: WorkspaceSwitcherProps) {
  const { workspaces, activeWorkspace, switchWorkspace, refreshWorkspaces } = useWorkspace()
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [logoFile, setLogoFile] = useState<File | null>(null)
  const [logoPreview, setLogoPreview] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [isUpdating, setIsUpdating] = useState(false)
  const [error, setError] = useState('')

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setLogoFile(file)
      const reader = new FileReader()
      reader.onloadend = () => setLogoPreview(reader.result as string)
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
  }

  const uploadLogo = async (workspaceId: string): Promise<string | null> => {
    if (!logoFile) return null
    try {
      const fileExt = logoFile.name.split('.').pop()
      const fileName = `${workspaceId}-${Date.now()}.${fileExt}`
      const { error: uploadError } = await supabase.storage
        .from('workspace-logos')
        .upload(fileName, logoFile)
      if (uploadError) throw uploadError
      const { data } = supabase.storage.from('workspace-logos').getPublicUrl(fileName)
      return data.publicUrl
    } catch (err) {
      console.error('Error uploading logo:', err)
      return null
    }
  }

  const handleUpdateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace) return
    setError('')
    setIsUpdating(true)
    try {
      if (logoFile) {
        const logoUrl = await uploadLogo(activeWorkspace.id)
        if (logoUrl) {
          const updateResult = await supabase
            .from('workspaces')
            .update({ logo_url: logoUrl } as never)
            .eq('id', activeWorkspace.id)
          if (updateResult.error) throw updateResult.error
        }
      }
      await refreshWorkspaces()
      setIsSettingsOpen(false)
      setLogoFile(null)
      setLogoPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update workspace')
    } finally {
      setIsUpdating(false)
    }
  }

  const openSettings = (workspace = activeWorkspace) => {
    if (!workspace) return
    switchWorkspace(workspace.id)
    setLogoPreview(workspace.logo_url || null)
    setIsSettingsOpen(true)
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsCreating(true)
    try {
      const result = await (supabase.rpc as any)('create_workspace', {
        workspace_name: workspaceName,
        workspace_slug: workspaceSlug,
      })
      if (result.error) throw result.error
      const workspaceId = result.data as string
      if (logoFile && workspaceId) {
        const logoUrl = await uploadLogo(workspaceId)
        if (logoUrl) {
          await supabase
            .from('workspaces')
            .update({ logo_url: logoUrl } as never)
            .eq('id', workspaceId)
        }
      }
      localStorage.setItem('activeWorkspaceId', workspaceId)
      await refreshWorkspaces()
      setIsDialogOpen(false)
      setWorkspaceName('')
      setWorkspaceSlug('')
      setLogoFile(null)
      setLogoPreview(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsCreating(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-start gap-1 px-2 pt-2 pb-1">
        <Skeleton className="h-8 flex-1 rounded-md bg-sidebar-accent/60" />
        {!isCollapsed && <Skeleton className="size-7 rounded-md" />}
      </div>
    )
  }

  return (
    <>
      <div className={cn('flex items-center justify-start gap-1 px-2 pt-2 pb-1', isCollapsed && 'flex-col')}>
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center justify-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent/60',
                    isCollapsed ? 'w-full justify-center px-1.5' : 'flex-1'
                  )}
                >
                  {activeWorkspace ? (
                    <WorkspaceAvatar name={activeWorkspace.name} logoUrl={activeWorkspace.logo_url} />
                  ) : (
                    <div className="size-6 rounded-sm bg-sidebar-accent" />
                  )}
                  {!isCollapsed && (
                    <>
                      <span className="truncate text-[13px] font-medium">
                        {activeWorkspace?.name || 'Workspace'}
                      </span>
                      <ChevronDownIcon className="ml-auto size-3 shrink-0 text-muted-foreground" />
                    </>
                  )}
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right" align="center" sideOffset={8}>
                {activeWorkspace?.name || 'Workspace'}
              </TooltipContent>
            )}
          </Tooltip>
          <DropdownMenuContent align="start" side="bottom" className="w-56">
            <DropdownMenuLabel>Workspaces</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {workspaces.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                className="cursor-pointer gap-2"
                onClick={() => switchWorkspace(workspace.id)}
              >
                <WorkspaceAvatar name={workspace.name} logoUrl={workspace.logo_url} size="sm" />
                <span className="flex-1 truncate">{workspace.name}</span>
                {activeWorkspace?.id === workspace.id && (
                  <span className="text-xs text-muted-foreground">Active</span>
                )}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onClick={() => openSettings()}>
              <SettingsIcon className="mr-2 size-4" />
              Workspace settings
            </DropdownMenuItem>
            <DropdownMenuItem className="cursor-pointer" onClick={() => setIsDialogOpen(true)}>
              <PlusIcon className="mr-2 size-4" />
              Create workspace
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {onToggleCollapse && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={onToggleCollapse}
                className="shrink-0 cursor-pointer rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-sidebar-accent/60 hover:text-sidebar-foreground"
              >
                <PanelLeftIcon className="size-3.5" />
              </button>
            </TooltipTrigger>
            {isCollapsed && (
              <TooltipContent side="right" align="center" sideOffset={8}>
                Expand sidebar
              </TooltipContent>
            )}
          </Tooltip>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 border-0 p-0 sm:max-w-lg">
          <DialogHeader className="px-6 pb-5 pt-6">
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>Set up a new workspace for your team</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateWorkspace} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-1">
              {error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Workspace logo (optional)</Label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                      <img src={logoPreview} alt="Logo preview" className="size-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30">
                      <BuildingIcon className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <span>Upload new</span>
                    </Button>
                    <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="workspace-name" className="cursor-pointer text-sm font-medium">Workspace name *</Label>
                <div className="relative">
                  <BuildingIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="workspace-name"
                    type="text"
                    placeholder="Acme Inc"
                    value={workspaceName}
                    onChange={(e) => {
                      setWorkspaceName(e.target.value)
                      setWorkspaceSlug(generateSlug(e.target.value))
                    }}
                    className="pl-10"
                    required
                  />
                </div>
              </div>
              {workspaceName && (
                <div className="space-y-2">
                  <Label htmlFor="workspace-slug" className="cursor-pointer text-sm font-medium">Workspace URL *</Label>
                  <div className="relative">
                    <HashIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      id="workspace-slug"
                      type="text"
                      placeholder="acme-inc"
                      value={workspaceSlug}
                      onChange={(e) => setWorkspaceSlug(e.target.value)}
                      className="pl-10"
                      required
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter className="px-6 pb-6 pt-5">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)} disabled={isCreating} className="cursor-pointer">Cancel</Button>
              <Button type="submit" loading={isCreating} disabled={!workspaceName || !workspaceSlug} className="cursor-pointer">
                Create workspace
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col gap-0 border-0 p-0 sm:max-w-lg">
          <DialogHeader className="px-6 pb-5 pt-6">
            <DialogTitle>Workspace Settings</DialogTitle>
            <DialogDescription>Update your workspace settings</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateWorkspace} className="flex flex-1 flex-col overflow-hidden">
            <div className="flex-1 space-y-5 overflow-y-auto px-6 py-1">
              {error && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <p>{error}</p>
                </div>
              )}
              <div className="space-y-3">
                <Label className="text-sm font-medium">Workspace logo</Label>
                <div className="flex items-center gap-4">
                  {logoPreview ? (
                    <div className="size-16 shrink-0 overflow-hidden rounded-md border border-border bg-background">
                      <img src={logoPreview} alt="Logo preview" className="size-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex size-16 shrink-0 items-center justify-center rounded-md border-2 border-dashed border-border bg-muted/30">
                      <BuildingIcon className="size-6 text-muted-foreground" />
                    </div>
                  )}
                  <label className="cursor-pointer">
                    <Button type="button" variant="outline" size="sm" asChild>
                      <span>Upload new</span>
                    </Button>
                    <input type="file" accept="image/*" onChange={handleLogoChange} className="hidden" />
                  </label>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-workspace-name">Workspace name</Label>
                <Input id="settings-workspace-name" value={activeWorkspace?.name || ''} disabled className="bg-muted" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="settings-workspace-slug">Workspace URL</Label>
                <Input id="settings-workspace-slug" value={activeWorkspace?.slug || ''} disabled className="bg-muted" />
              </div>
            </div>
            <DialogFooter className="px-6 pb-6 pt-5">
              <Button type="button" variant="outline" onClick={() => setIsSettingsOpen(false)} disabled={isUpdating} className="cursor-pointer">Cancel</Button>
              <Button type="submit" loading={isUpdating} disabled={!logoFile} className="cursor-pointer">Save Changes</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
