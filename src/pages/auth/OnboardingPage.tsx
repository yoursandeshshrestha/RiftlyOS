import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { LogoutIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { WorkspaceChoiceCard } from './components/WorkspaceChoiceCard'
import { CreateWorkspaceForm } from './components/CreateWorkspaceForm'
import { JoinWorkspaceForm } from './components/JoinWorkspaceForm'
import { AuthLayout } from './AuthLayout'

type OnboardingMode = 'choose' | 'create' | 'join'

const MODE_COPY: Record<OnboardingMode, { title: string; subtitle: string }> = {
  choose: {
    title: 'Welcome to Riftly',
    subtitle: 'Create a workspace or join an existing one to get started',
  },
  create: {
    title: 'Create workspace',
    subtitle: 'Set up your team workspace',
  },
  join: {
    title: 'Join workspace',
    subtitle: 'Enter the invite code provided by your team',
  },
}

export function OnboardingPage() {
  const navigate = useNavigate()
  const [mode, setMode] = useState<OnboardingMode>('choose')
  const [isLoading, setIsLoading] = useState(false)

  const [workspaceName, setWorkspaceName] = useState('')
  const [workspaceSlug, setWorkspaceSlug] = useState('')
  const [inviteCode, setInviteCode] = useState('')

  const generateSlug = (name: string) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')

  const handleWorkspaceNameChange = (name: string) => {
    setWorkspaceName(name)
    setWorkspaceSlug(generateSlug(name))
  }

  const handleCreateWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const { error } = await supabase.rpc(
        'create_workspace',
        {
          workspace_name: workspaceName,
          workspace_slug: workspaceSlug,
        } as never,
      )

      if (error) throw error

      navigate('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create workspace')
    } finally {
      setIsLoading(false)
    }
  }

  const handleJoinWorkspace = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)

    try {
      const { error } = await supabase.rpc(
        'join_workspace',
        {
          invite_code_input: inviteCode,
        } as never,
      )

      if (error) throw error

      navigate('/dashboard')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to join workspace')
    } finally {
      setIsLoading(false)
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const copy = MODE_COPY[mode]

  return (
    <AuthLayout
      title={copy.title}
      subtitle={copy.subtitle}
      headerAction={
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void handleLogout()}
          className="cursor-pointer text-muted-foreground hover:text-foreground"
          aria-label="Sign out"
        >
          <LogoutIcon className="size-4" />
        </Button>
      }
    >
      {mode === 'choose' ? (
        <WorkspaceChoiceCard
          onCreateWorkspace={() => setMode('create')}
          onJoinWorkspace={() => setMode('join')}
        />
      ) : null}

      {mode === 'create' ? (
        <CreateWorkspaceForm
          workspaceName={workspaceName}
          workspaceSlug={workspaceSlug}
          isLoading={isLoading}
          onWorkspaceNameChange={handleWorkspaceNameChange}
          onWorkspaceSlugChange={setWorkspaceSlug}
          onSubmit={handleCreateWorkspace}
          onBack={() => setMode('choose')}
        />
      ) : null}

      {mode === 'join' ? (
        <JoinWorkspaceForm
          inviteCode={inviteCode}
          isLoading={isLoading}
          onInviteCodeChange={setInviteCode}
          onSubmit={handleJoinWorkspace}
          onBack={() => setMode('choose')}
        />
      ) : null}
    </AuthLayout>
  )
}
