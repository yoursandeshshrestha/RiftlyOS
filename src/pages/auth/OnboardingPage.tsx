import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { WorkspaceChoiceCard } from './components/WorkspaceChoiceCard'
import { CreateWorkspaceForm } from './components/CreateWorkspaceForm'
import { JoinWorkspaceForm } from './components/JoinWorkspaceForm'
import { HeroImage } from './components/HeroImage'
import { LogoutIcon } from '@/components/icons'

export function OnboardingPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>('choose')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  // Create workspace state
  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')

  // Join workspace state
  const [inviteCode, setInviteCode] = useState('')

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  const handleWorkspaceNameChange = (name: string) => {
    setWorkspaceName(name)
    setWorkspaceSlug(generateSlug(name))
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { error } = await supabase.rpc(
        'create_workspace',
        {
          workspace_name: workspaceName,
          workspace_slug: workspaceSlug,
        } as never
      )

      if (error) throw error

      // Redirect to dashboard
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsLoading(false)
    }
  }

  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    try {
      const { error } = await supabase.rpc(
        'join_workspace',
        {
          invite_code_input: inviteCode,
        } as never
      )

      if (error) throw error

      // Redirect to dashboard
      navigate('/dashboard')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join workspace')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  // Render Choose Mode
  if (mode === 'choose') {
    return (
      <div className="flex h-screen">
        {/* Left Side - Onboarding (2/5) */}
        <div className="flex w-2/5 items-center justify-center bg-background p-8">
          <div className="w-full max-w-md">
            <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
              <div className="mb-2 flex items-start justify-between px-1">
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Welcome to Riftly</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Get started by creating a workspace or joining an existing one
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="cursor-pointer"
                >
                  <LogoutIcon className="size-4" />
                </Button>
              </div>
              <Card className="rounded-lg border ring-0">
                <CardContent className="pt-6">
                  <WorkspaceChoiceCard
                    onCreateWorkspace={() => setMode('create')}
                    onJoinWorkspace={() => setMode('join')}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Right Side - Image (3/5) */}
        <HeroImage alt="Onboarding background" />
      </div>
    )
  }

  // Render Create Workspace Mode
  if (mode === 'create') {
    return (
      <div className="flex h-screen">
        {/* Left Side - Create Workspace (2/5) */}
        <div className="flex w-2/5 items-center justify-center bg-background p-8">
          <div className="w-full max-w-md">
            <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
              <div className="mb-2 flex items-start justify-between px-1">
                <div>
                  <div className="text-2xl font-semibold tracking-tight">Create workspace</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Set up your team workspace
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleLogout}
                  className="cursor-pointer"
                >
                  <LogoutIcon className="size-4" />
                </Button>
              </div>
              <Card className="rounded-lg border ring-0">
                <CardContent className="pt-6">
                  <CreateWorkspaceForm
                    workspaceName={workspaceName}
                    workspaceSlug={workspaceSlug}
                    error={error}
                    isLoading={isLoading}
                    onWorkspaceNameChange={handleWorkspaceNameChange}
                    onWorkspaceSlugChange={setWorkspaceSlug}
                    onSubmit={handleCreateWorkspace}
                    onBack={() => setMode('choose')}
                  />
                </CardContent>
              </Card>
            </div>
          </div>
        </div>

        {/* Right Side - Image (3/5) */}
        <HeroImage alt="Onboarding background" />
      </div>
    )
  }

  // Render Join Workspace Mode
  return (
    <div className="flex h-screen">
      {/* Left Side - Join Workspace (2/5) */}
      <div className="flex w-2/5 items-center justify-center bg-background p-8">
        <div className="w-full max-w-md">
          <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
            <div className="mb-2 flex items-start justify-between px-1">
              <div>
                <div className="text-2xl font-semibold tracking-tight">Join workspace</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Enter the invite code provided by your team
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleLogout}
                className="cursor-pointer"
              >
                <LogoutIcon className="size-4" />
              </Button>
            </div>
            <Card className="rounded-lg border ring-0">
              <CardContent className="pt-6">
                <JoinWorkspaceForm
                  inviteCode={inviteCode}
                  error={error}
                  isLoading={isLoading}
                  onInviteCodeChange={setInviteCode}
                  onSubmit={handleJoinWorkspace}
                  onBack={() => setMode('choose')}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Right Side - Image (3/5) */}
      <HeroImage alt="Onboarding background" />
    </div>
  )
}
