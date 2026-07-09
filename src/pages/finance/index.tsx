import { useCallback, useEffect, useState } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { Button } from '@/components/ui/button'
import { StatCard } from '@/components/ui/stat-card'
import { PlusIcon } from '@/components/icons'
import {
  getMRR,
  getOutstanding,
  getPaidVsOverdue,
  getRecognisedRevenue,
  getRevenueTarget,
} from '@/lib/finance/metrics'
import { formatMoney } from '@/lib/finance/money'
import { RevenueGauge } from '@/components/finance/RevenueGauge'
import { PaidOverdueChart } from '@/components/finance/PaidOverdueChart'
import { CreateInvoiceDialog } from '@/components/finance/CreateInvoiceDialog'
import { InvoicesTable } from '@/components/finance/InvoicesTable'
import { RetainersTable } from '@/components/finance/RetainersTable'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageLayout } from '@/components/layout/PageLayout'
import { getInvoicesWithDetails, type InvoiceListItem } from '@/lib/finance/invoices'
import { getRetainersWithDetails, type RetainerListItem } from '@/lib/finance/subscriptions'
import { saveRevenueTarget } from '@/lib/finance/targets'
import { SetTargetDialog } from '@/pages/revenue/components/SetTargetDialog'
import { fromMinorUnits } from '@/lib/finance/money'

export default function FinancePage() {
  const { activeWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [invoicesLoading, setInvoicesLoading] = useState(true)
  const [retainersLoading, setRetainersLoading] = useState(true)
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])
  const [retainers, setRetainers] = useState<RetainerListItem[]>([])
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false)
  const [metrics, setMetrics] = useState({
    mrr: 0,
    outstanding: 0,
    recognised: 0,
    paid: 0,
    overdue: 0,
    target: null as number | null,
  })

  const loadFinanceData = useCallback(async (workspaceId: string) => {
    setLoading(true)
    setInvoicesLoading(true)
    setRetainersLoading(true)

    try {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      const period = monthStart.toISOString().slice(0, 10)

      const [
        mrr,
        outstanding,
        split,
        recognised,
        target,
        invoiceData,
        retainerData,
      ] = await Promise.all([
        getMRR(workspaceId),
        getOutstanding(workspaceId),
        getPaidVsOverdue(workspaceId),
        getRecognisedRevenue(workspaceId, monthStart, nextMonth),
        getRevenueTarget(workspaceId, period),
        getInvoicesWithDetails(workspaceId),
        getRetainersWithDetails(workspaceId),
      ])

      setMetrics({
        mrr,
        outstanding,
        recognised,
        paid: split.paid,
        overdue: split.overdue,
        target: target ?? null,
      })
      setInvoices(invoiceData.invoices)
      setRetainers(retainerData.retainers)
    } catch (error) {
      console.error('Failed to load finance metrics:', error)
    } finally {
      setLoading(false)
      setInvoicesLoading(false)
      setRetainersLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setLoading(false)
      setInvoicesLoading(false)
      setRetainersLoading(false)
      setInvoices([])
      setRetainers([])
      return
    }

    void loadFinanceData(activeWorkspace.id)
  }, [activeWorkspace?.id, loadFinanceData])

  const currentVsTarget = metrics.mrr + metrics.recognised

  const handleFinanceUpdated = async () => {
    if (!activeWorkspace?.id) return
    await loadFinanceData(activeWorkspace.id)
  }

  const handleSaveTarget = async (amountMajor: number) => {
    if (!activeWorkspace?.id) return

    const now = new Date()
    const period = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10)

    await saveRevenueTarget(activeWorkspace.id, period, amountMajor)
    setIsTargetDialogOpen(false)
    await loadFinanceData(activeWorkspace.id)
  }

  return (
    <PageLayout
      header={
        <PageHeader title="Finance" description="Stripe invoices, retainers, and billing metrics">
          <Button className="cursor-pointer" onClick={() => setIsCreateDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Create Invoice
          </Button>
        </PageHeader>
      }
    >
        <CreateInvoiceDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          workspaceId={activeWorkspace?.id || ''}
          onSuccess={handleFinanceUpdated}
        />

        <SetTargetDialog
          open={isTargetDialogOpen}
          onOpenChange={setIsTargetDialogOpen}
          currentTarget={
            metrics.target != null ? fromMinorUnits(metrics.target, 'gbp') : undefined
          }
          onSave={handleSaveTarget}
        />

        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="MRR" value={formatMoney(metrics.mrr, 'gbp')} isLoading={loading} />
          <StatCard
            title="One-off Revenue"
            value={formatMoney(metrics.recognised, 'gbp')}
            isLoading={loading}
          />
          <StatCard
            title="Outstanding"
            value={formatMoney(metrics.outstanding, 'gbp')}
            isLoading={loading}
          />
          <StatCard
            title="Overdue"
            value={formatMoney(metrics.overdue, 'gbp')}
            isLoading={loading}
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <RevenueGauge
            current={currentVsTarget}
            target={metrics.target}
            currency="gbp"
            onSetTarget={() => setIsTargetDialogOpen(true)}
          />
          <PaidOverdueChart
            paid={metrics.paid}
            overdue={metrics.overdue}
            currency="gbp"
          />
        </div>

        <RetainersTable
          retainers={retainers}
          isLoading={retainersLoading}
          workspaceId={activeWorkspace?.id}
          onUpdated={handleFinanceUpdated}
        />
        <InvoicesTable invoices={invoices} isLoading={invoicesLoading} />
    </PageLayout>
  )
}
