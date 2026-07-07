import { useEffect, useState } from 'react'
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
import { PageHeader } from '@/components/layout/PageHeader'

export default function FinancePage() {
  const { currentWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [metrics, setMetrics] = useState({
    mrr: 0,
    outstanding: 0,
    recognised: 0,
    paid: 0,
    overdue: 0,
    target: 0,
  })

  useEffect(() => {
    if (!currentWorkspace?.id) {
      setLoading(false)
      return
    }

    const loadMetrics = async () => {
      setLoading(true)
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
        const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        const period = monthStart.toISOString().slice(0, 10)

        const [mrr, outstanding, split, recognised, target] = await Promise.all([
          getMRR(currentWorkspace.id),
          getOutstanding(currentWorkspace.id),
          getPaidVsOverdue(currentWorkspace.id),
          getRecognisedRevenue(currentWorkspace.id, monthStart, nextMonth),
          getRevenueTarget(currentWorkspace.id, period),
        ])

        setMetrics({
          mrr,
          outstanding,
          recognised,
          paid: split.paid,
          overdue: split.overdue,
          target: target ?? 0,
        })
      } catch (error) {
        console.error('Failed to load finance metrics:', error)
      } finally {
        setLoading(false)
      }
    }

    loadMetrics()
  }, [currentWorkspace?.id])

  const currentVsTarget = metrics.mrr + metrics.recognised

  const handleInvoiceCreated = async () => {
    // Reload metrics after invoice is created
    if (!currentWorkspace?.id) return

    try {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
      const period = monthStart.toISOString().slice(0, 10)

      const [mrr, outstanding, split, recognised, target] = await Promise.all([
        getMRR(currentWorkspace.id),
        getOutstanding(currentWorkspace.id),
        getPaidVsOverdue(currentWorkspace.id),
        getRecognisedRevenue(currentWorkspace.id, monthStart, nextMonth),
        getRevenueTarget(currentWorkspace.id, period),
      ])

      setMetrics({
        mrr,
        outstanding,
        recognised,
        paid: split.paid,
        overdue: split.overdue,
        target: target ?? 0,
      })
    } catch (error) {
      console.error('Failed to reload metrics:', error)
    }
  }

  return (
    <div className="space-y-6">
        <PageHeader
          title="Finance"
          description="Track invoices, subscriptions, and revenue metrics"
        >
          <Button className="cursor-pointer" onClick={() => setIsCreateDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Create Invoice
          </Button>
        </PageHeader>

        <CreateInvoiceDialog
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
          workspaceId={currentWorkspace?.id || ''}
          onSuccess={handleInvoiceCreated}
        />

        {/* Stats Cards */}
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

        {/* Charts */}
        <div className="grid gap-4 lg:grid-cols-2">
          <RevenueGauge
            current={currentVsTarget}
            target={metrics.target}
            currency="gbp"
          />
          <PaidOverdueChart
            paid={metrics.paid}
            overdue={metrics.overdue}
            currency="gbp"
          />
        </div>
    </div>
  )
}
