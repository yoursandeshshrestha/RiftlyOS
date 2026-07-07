import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { DeleteConfirmDialog } from '@/components/ui/delete-confirm-dialog'
import { PlusIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { useAuth } from '@/contexts/AuthContext'
import { useNavigate } from 'react-router-dom'
import { DealColumn } from './components/DealColumn'
import { DealDetailsSheet } from './components/DealDetailsSheet'
import { DealFormDialog } from './components/DealFormDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import type { Deal } from './types'
import { STAGES } from './types'

export function DealsPage() {
  const navigate = useNavigate()
  const { activeWorkspace } = useWorkspace()
  const { user } = useAuth()
  const [deals, setDeals] = useState<Deal[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [draggedDeal, setDraggedDeal] = useState<Deal | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState('')
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null)
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)

  // Check if user is owner
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
    }

    checkRole()
  }, [activeWorkspace?.id, user?.id, navigate])

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchDeals()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id])

  const fetchDeals = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)
      const { data, error } = await supabase
        .from('deals')
        .select('*')
        .eq('workspace_id', activeWorkspace.id)
        .order('position', { ascending: true })

      if (error) throw error

      setDeals(data || [])
    } catch (error) {
      console.error('Error fetching deals:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleDragStart = (deal: Deal) => {
    setDraggedDeal(deal)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
  }

  const handleDrop = async (targetStage: Deal['stage']) => {
    if (!draggedDeal || !activeWorkspace?.id) return

    // Store previous state for rollback
    const previousDeals = [...deals]

    // Optimistically update UI immediately
    setDeals(deals.map(deal =>
      deal.id === draggedDeal.id
        ? { ...deal, stage: targetStage }
        : deal
    ))
    setDraggedDeal(null)

    try {
      const { error } = await supabase
        .from('deals')
        .update({ stage: targetStage } as never)
        .eq('id', draggedDeal.id)

      if (error) throw error
    } catch (error) {
      console.error('Error updating deal:', error)
      // Revert to previous state on error
      setDeals(previousDeals)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 0,
    }).format(value)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  const handleCardClick = (deal: Deal) => {
    setSelectedDeal(deal)
    setIsSheetOpen(true)
  }

  const getDealsForStage = (stage: string) => {
    return deals.filter((deal) => deal.stage === stage)
  }

  const getTotalValue = (stage: string) => {
    return getDealsForStage(stage).reduce((sum, deal) => sum + Number(deal.deal_value), 0)
  }

  const handleCreateDeal = async (data: {
    prospectName: string
    services: string
    dealValue: string
    nextAction: string
  }) => {
    if (!activeWorkspace?.id || !user?.id) return

    setError('')
    setIsCreating(true)

    try {
      if (selectedDeal) {
        // Update existing deal
        const { error: updateError } = await supabase
          .from('deals')
          .update({
            prospect_name: data.prospectName,
            services: data.services,
            deal_value: parseFloat(data.dealValue) || 0,
            next_action: data.nextAction || null,
          } as never)
          .eq('id', selectedDeal.id)

        if (updateError) throw updateError
      } else {
        // Create new deal
        const { error: createError } = await supabase
          .from('deals')
          .insert({
            workspace_id: activeWorkspace.id,
            prospect_name: data.prospectName,
            services: data.services,
            deal_value: parseFloat(data.dealValue) || 0,
            stage: 'lead',
            next_action: data.nextAction || null,
            created_by: user.id,
          } as never)

        if (createError) throw createError
      }

      await fetchDeals()
      setIsDialogOpen(false)
      setSelectedDeal(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : selectedDeal ? 'Failed to update deal' : 'Failed to create deal')
    } finally {
      setIsCreating(false)
    }
  }

  const handleEditDeal = () => {
    if (!selectedDeal) return
    setIsSheetOpen(false)
    setIsDialogOpen(true)
  }

  const handleDeleteClick = () => {
    setIsSheetOpen(false)
    setIsDeleteDialogOpen(true)
  }

  const handleConfirmDelete = async () => {
    if (!selectedDeal) return

    setIsDeleting(true)

    try {
      const { error } = await supabase
        .from('deals')
        .delete()
        .eq('id', selectedDeal.id)

      if (error) throw error

      // Refresh deals list
      await fetchDeals()

      // Close dialogs and sheet
      setIsDeleteDialogOpen(false)
      setIsSheetOpen(false)
      setSelectedDeal(null)
    } catch (err) {
      console.error('Error deleting deal:', err)
      alert('Failed to delete deal')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Track your deals through the sales process"
      >
        <Button className="cursor-pointer" onClick={() => setIsDialogOpen(true)}>
          <PlusIcon className="size-4" />
          New Deal
        </Button>
      </PageHeader>

      {/* Kanban Board */}
      <div className="flex items-start gap-2 overflow-x-auto pb-6 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {STAGES.map((stage) => (
          <DealColumn
            key={stage.id}
            stage={stage}
            deals={getDealsForStage(stage.id)}
            isLoading={isLoading}
            totalValue={getTotalValue(stage.id)}
            onDragOver={handleDragOver}
            onDrop={() => handleDrop(stage.id as Deal['stage'])}
            onDragStart={handleDragStart}
            onCardClick={handleCardClick}
            formatCurrency={formatCurrency}
          />
        ))}
      </div>

      {/* Deal Details Sheet */}
      <DealDetailsSheet
        open={isSheetOpen}
        onOpenChange={setIsSheetOpen}
        deal={selectedDeal}
        onEdit={handleEditDeal}
        onDelete={handleDeleteClick}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />

      {/* Deal Form Dialog */}
      <DealFormDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        selectedDeal={selectedDeal}
        onSubmit={handleCreateDeal}
        isCreating={isCreating}
        error={error}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        onConfirm={handleConfirmDelete}
        title="Delete Deal"
        description={`Are you sure you want to delete the deal with ${selectedDeal?.prospect_name}? This action cannot be undone.`}
        isDeleting={isDeleting}
      />
    </div>
  )
}
