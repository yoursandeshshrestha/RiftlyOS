import { useEffect, useState } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { InvoicesTable } from '@/components/finance/InvoicesTable'
import { getInvoicesWithDetails, type InvoiceListItem } from '@/lib/finance/invoices'
import { PageHeader } from '@/components/layout/PageHeader'

export default function InvoicesPage() {
  const { activeWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<InvoiceListItem[]>([])

  useEffect(() => {
    if (!activeWorkspace?.id) {
      setLoading(false)
      setInvoices([])
      return
    }

    const loadInvoices = async () => {
      setLoading(true)
      try {
        const { invoices: data } = await getInvoicesWithDetails(activeWorkspace.id, 100)
        setInvoices(data)
      } catch (error) {
        console.error('Failed to load invoices:', error)
      } finally {
        setLoading(false)
      }
    }

    loadInvoices()
  }, [activeWorkspace?.id])

  return (
    <div className="space-y-4">
      <PageHeader
        title="Invoices"
        description="View and manage all invoices for this workspace."
      />

      <InvoicesTable invoices={invoices} isLoading={loading} />
    </div>
  )
}
