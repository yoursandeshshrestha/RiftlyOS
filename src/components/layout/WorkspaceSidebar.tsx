import { useState } from 'react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ProfileDropdown } from './ProfileDropdown'
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
import {
  PlusIcon,
  BuildingIcon,
  HashIcon,
  AlertCircleIcon,
  UploadIcon,
  CloseIcon,
} from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { supabase } from '@/lib/supabase'

export function WorkspaceSidebar() {
  const { user } = useAuth()
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
      reader.onloadend = () => {
        setLogoPreview(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleRemoveLogo = () => {
    setLogoFile(null)
    setLogoPreview(null)
  }

  const handleUpdateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeWorkspace) return

    setError('')
    setIsUpdating(true)

    try {
      // Upload new logo if provided
      if (logoFile) {
        const logoUrl = await uploadLogo(activeWorkspace.id)
        if (logoUrl) {
          // Update workspace with new logo URL
          const updateResult = await supabase
            .from('workspaces')
            .update({ logo_url: logoUrl } as never)
            .eq('id', activeWorkspace.id)

          if (updateResult.error) throw updateResult.error
        }
      }

      // Refresh workspaces list
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

  const openSettings = () => {
    if (activeWorkspace) {
      setLogoPreview(activeWorkspace.logo_url || null)
      setIsSettingsOpen(true)
    }
  }

  const uploadLogo = async (workspaceId: string): Promise<string | null> => {
    if (!logoFile) return null

    try {
      const fileExt = logoFile.name.split('.').pop()
      const fileName = `${workspaceId}-${Date.now()}.${fileExt}`
      const filePath = `${fileName}`

      const { error: uploadError } = await supabase.storage
        .from('workspace-logos')
        .upload(filePath, logoFile)

      if (uploadError) throw uploadError

      const { data } = supabase.storage
        .from('workspace-logos')
        .getPublicUrl(filePath)

      return data.publicUrl
    } catch (err) {
      console.error('Error uploading logo:', err)
      return null
    }
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsCreating(true)

    try {
      // Create workspace first
      const result = await (supabase.rpc as any)('create_workspace', {
        workspace_name: workspaceName,
        workspace_slug: workspaceSlug,
      })

      if (result.error) throw result.error

      const workspaceId = result.data as string

      // Upload workspace logo if provided
      if (logoFile && workspaceId) {
        const logoUrl = await uploadLogo(workspaceId)
        if (logoUrl) {
          // Update workspace with logo URL
          const updateResult = await supabase
            .from('workspaces')
            .update({ logo_url: logoUrl } as never)
            .eq('id', workspaceId)

          if (updateResult.error) console.error('Error updating workspace logo:', updateResult.error)
        }
      }

      // Refresh workspaces list
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

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(n => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <aside className="flex h-screen w-16 flex-col items-center border-r border-sidebar-border bg-sidebar py-3">
      {/* Workspaces */}
      <div className="flex flex-1 flex-col items-center gap-2">
        {workspaces.map((workspace) => (
          <DropdownMenu key={workspace.id}>
            <DropdownMenuTrigger asChild>
              <button
                onClick={() => switchWorkspace(workspace.id)}
                className="group cursor-pointer"
              >
                <Avatar className="size-10 rounded-lg transition-all hover:rounded-xl">
                  {workspace.logo_url ? (
                    <img
                      src={workspace.logo_url}
                      alt={workspace.name}
                      className="size-full rounded-lg object-cover transition-all group-hover:rounded-xl"
                    />
                  ) : (
                    <AvatarFallback className="rounded-lg bg-sidebar-accent text-sidebar-accent-foreground transition-all group-hover:rounded-xl">
                      {workspace.name.substring(0, 2).toUpperCase()}
                    </AvatarFallback>
                  )}
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="start" className="w-56">
              <div className="px-2 py-1.5">
                <p className="text-sm font-medium dark:text-gray-100">{workspace.name}</p>
                <p className="text-xs text-muted-foreground dark:text-gray-400">Workspace</p>
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="cursor-pointer" onClick={openSettings}>
                <svg
                  className="mr-2 size-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                  />
                </svg>
                Workspace Settings
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ))}

        {/* Add Workspace Button */}
        <button
          onClick={() => setIsDialogOpen(true)}
          className="group flex size-10 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-sidebar-border/50 text-sidebar-foreground transition-all hover:border-sidebar-border hover:bg-sidebar-accent/50"
        >
          <PlusIcon className="size-5" />
        </button>

        {/* Create Workspace Dialog */}
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-lg">
            {/* Fixed Header */}
            <DialogHeader className="border-b border-border/50 px-6 py-4">
              <DialogTitle>Create workspace</DialogTitle>
              <DialogDescription>
                Set up a new workspace for your team
              </DialogDescription>
            </DialogHeader>

            {/* Scrollable Content */}
            <form onSubmit={handleCreateWorkspace} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                {/* Error Message */}
                {error && (
                  <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                {/* Logo Upload */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium cursor-pointer">Workspace logo (optional)</Label>
                  {logoPreview ? (
                    <div className="relative">
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="size-12 rounded-lg object-cover"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{logoFile?.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {logoFile && (logoFile.size / 1024).toFixed(2)} KB
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="cursor-pointer rounded-md p-1 hover:bg-destructive/10"
                        >
                          <CloseIcon className="size-4 text-destructive" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted p-6 transition-colors hover:bg-muted/80">
                      <UploadIcon className="size-8 text-muted-foreground" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Click to upload logo</p>
                        <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {/* Workspace Name */}
                <div className="space-y-2">
                  <Label htmlFor="workspace-name" className="text-sm font-medium cursor-pointer">
                    Workspace name *
                  </Label>
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

                {/* Workspace Slug */}
                {workspaceName && (
                  <div className="space-y-2">
                    <Label htmlFor="workspace-slug" className="text-sm font-medium cursor-pointer">
                      Workspace URL *
                    </Label>
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
                    <p className="text-xs text-muted-foreground">
                      This will be used in your workspace URL
                    </p>
                  </div>
                )}
              </div>

              {/* Fixed Footer */}
              <DialogFooter className="border-t border-border/50 px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsDialogOpen(false)}
                  className="cursor-pointer"
                  disabled={isCreating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="cursor-pointer"
                  disabled={isCreating || !workspaceName || !workspaceSlug}
                >
                  {isCreating ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Creating...
                    </span>
                  ) : (
                    'Create workspace'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Workspace Settings Dialog */}
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogContent className="flex max-h-[90vh] flex-col gap-0 p-0 sm:max-w-lg">
            {/* Fixed Header */}
            <DialogHeader className="border-b border-border/50 px-6 py-4">
              <DialogTitle>Workspace Settings</DialogTitle>
              <DialogDescription>
                Update your workspace settings
              </DialogDescription>
            </DialogHeader>

            {/* Scrollable Content */}
            <form onSubmit={handleUpdateWorkspace} className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
                {/* Error Message */}
                {error && (
                  <div className="flex items-start gap-2 rounded-xl bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                {/* Logo Upload */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium cursor-pointer">Workspace logo</Label>
                  {logoPreview ? (
                    <div className="relative">
                      <div className="flex items-center gap-3 rounded-xl border border-border bg-muted p-3">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="size-12 rounded-lg object-cover"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">
                            {logoFile?.name || 'Current logo'}
                          </p>
                          {logoFile && (
                            <p className="text-xs text-muted-foreground">
                              {(logoFile.size / 1024).toFixed(2)} KB
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={handleRemoveLogo}
                          className="cursor-pointer rounded-md p-1 hover:bg-destructive/10"
                        >
                          <CloseIcon className="size-4 text-destructive" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted p-6 transition-colors hover:bg-muted/80">
                      <UploadIcon className="size-8 text-muted-foreground" />
                      <div className="text-center">
                        <p className="text-sm font-medium">Click to upload logo</p>
                        <p className="text-xs text-muted-foreground">PNG, JPG up to 5MB</p>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {/* Workspace Name (Read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="settings-workspace-name" className="text-sm font-medium">
                    Workspace name
                  </Label>
                  <Input
                    id="settings-workspace-name"
                    type="text"
                    value={activeWorkspace?.name || ''}
                    disabled
                    className="cursor-not-allowed bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Workspace name cannot be changed
                  </p>
                </div>

                {/* Workspace Slug (Read-only) */}
                <div className="space-y-2">
                  <Label htmlFor="settings-workspace-slug" className="text-sm font-medium">
                    Workspace URL
                  </Label>
                  <Input
                    id="settings-workspace-slug"
                    type="text"
                    value={activeWorkspace?.slug || ''}
                    disabled
                    className="cursor-not-allowed bg-muted"
                  />
                  <p className="text-xs text-muted-foreground">
                    Workspace URL cannot be changed
                  </p>
                </div>
              </div>

              {/* Fixed Footer */}
              <DialogFooter className="border-t border-border/50 px-6 py-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsSettingsOpen(false)
                    setLogoFile(null)
                    setLogoPreview(activeWorkspace?.logo_url || null)
                    setError('')
                  }}
                  className="cursor-pointer"
                  disabled={isUpdating}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className="cursor-pointer"
                  disabled={isUpdating || !logoFile}
                >
                  {isUpdating ? (
                    <span className="flex items-center gap-2">
                      <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Updating...
                    </span>
                  ) : (
                    'Save Changes'
                  )}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* User Profile */}
      <div className="mt-auto">
        <ProfileDropdown align="end">
          <button className="group cursor-pointer">
            <Avatar className="size-10 rounded-lg transition-all hover:rounded-xl">
              <AvatarFallback className="rounded-lg bg-sidebar-accent text-sidebar-accent-foreground transition-all group-hover:rounded-xl">
                {user ? getInitials(user.name) : 'U'}
              </AvatarFallback>
            </Avatar>
          </button>
        </ProfileDropdown>
      </div>
    </aside>
  )
}
