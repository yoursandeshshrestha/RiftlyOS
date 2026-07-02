import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { RefreshIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { retryEmailDelivery } from '@/lib/email'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { EmailStatsCards } from './components/EmailStatsCards'
import { EmailDeliveriesTable } from './components/EmailDeliveriesTable'
import { EmailDetailsSheet } from './components/EmailDetailsSheet'
import type { EmailDelivery, EmailDeliveryStatus } from './types'

type StatusFilter = 'all' | EmailDeliveryStatus

export function EmailsPage() {
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [deliveries, setDeliveries] = useState<EmailDelivery[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [selectedDelivery, setSelectedDelivery] = useState<EmailDelivery | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [retryingId, setRetryingId] = useState<string | null>(null)

  useEffect(() => {
    const checkRole = async () => {
      if (!activeWorkspace?.id || !user?.id) return

      const { data, error } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('workspace_id', activeWorkspace.id)
        .eq('user_id', user.id)
        .single()

      if (error || (data as { role: string })?.role !== 'owner') {
        navigate('/dashboard')
        return
      }

      setUserRole((data as { role: string }).role)
    }

    void checkRole()
  }, [activeWorkspace?.id, user?.id, navigate])

  const fetchDeliveries = useCallback(async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('email_queue')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('created_at', { ascending: false })

      if (error) throw error

      setDeliveries((data ?? []) as unknown as EmailDelivery[])
    } catch (error) {
      console.error('Error fetching email deliveries:', error)
      toast.error('Failed to load email deliveries')
    } finally {
      setIsLoading(false)
    }
  }, [activeWorkspace?.id])

  useEffect(() => {
    if (activeWorkspace?.id && userRole === 'owner') {
      void fetchDeliveries()
    }
  }, [activeWorkspace?.id, userRole, fetchDeliveries])

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const formatDateTime = (value: string | null) => {
    if (!value) return '—'
    return new Date(value).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  }

  const filteredDeliveries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return deliveries.filter((delivery) => {
      const matchesStatus = statusFilter === 'all' || delivery.status === statusFilter
      if (!matchesStatus) return false

      if (!query) return true

      const templateLabel = delivery.template.replace(/-/g, ' ')
      return (
        delivery.recipient.toLowerCase().includes(query) ||
        (delivery.subject?.toLowerCase().includes(query) ?? false) ||
        templateLabel.toLowerCase().includes(query) ||
        (delivery.error_message?.toLowerCase().includes(query) ?? false)
      )
    })
  }, [deliveries, searchQuery, statusFilter])

  const stats = useMemo(() => ({
    total: deliveries.length,
    sent: deliveries.filter((d) => d.status === 'sent').length,
    failed: deliveries.filter((d) => d.status === 'failed').length,
    pending: deliveries.filter((d) => d.status === 'pending').length,
  }), [deliveries])

  const handleRetry = async (delivery: EmailDelivery) => {
    if (!activeWorkspace?.id) return

    setRetryingId(delivery.id)
    try {
      const result = await retryEmailDelivery(delivery.id, activeWorkspace.id)
      if (!result.queued) {
        toast.error(result.error ?? 'Failed to retry email')
        return
      }

      toast.success('Email queued for retry')
      await fetchDeliveries()
    } catch (error) {
      console.error('Retry failed:', error)
      toast.error('Failed to retry email')
    } finally {
      setRetryingId(null)
    }
  }

  const handleSelect = (delivery: EmailDelivery) => {
    setSelectedDelivery(delivery)
    setIsSheetOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email Deliveries</h1>
          <p className="text-muted-foreground">
            View outbound emails, failure reasons, and retry failed sends.
          </p>
        </div>
        <Button
          variant="outline"
          className="cursor-pointer self-start"
          onClick={() => void fetchDeliveries()}
          disabled={isLoading}
        >
          <RefreshIcon className="mr-2 size-4" />
          Refresh
        </Button>
      </div>

      <EmailStatsCards stats={stats} isLoading={isLoading} />

      <EmailDeliveriesTable
        deliveries={filteredDeliveries}
        isLoading={isLoading}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        retryingId={retryingId}
        onSelect={handleSelect}
        onRetry={(delivery) => void handleRetry(delivery)}
        formatDate={formatDate}
      />

      <EmailDetailsSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        delivery={selectedDelivery}
        onRetry={(delivery) => void handleRetry(delivery)}
        isRetrying={retryingId === selectedDelivery?.id}
        formatDateTime={formatDateTime}
      />
    </div>
  )
}
