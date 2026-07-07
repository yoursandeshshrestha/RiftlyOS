import { useEffect, useState } from 'react'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { getInvoices } from '@/lib/finance/metrics'
import { formatMoney } from '@/lib/finance/money'
import { PageHeader } from '@/components/layout/PageHeader'
import type { Database } from '@/lib/database.types'

type Invoice = Database['public']['Tables']['invoices']['Row']

export default function InvoicesPage() {
  const { currentWorkspace } = useWorkspace()
  const [loading, setLoading] = useState(true)
  const [invoices, setInvoices] = useState<Invoice[]>([])

  useEffect(() => {
    if (!currentWorkspace?.id) return

    const loadInvoices = async () => {
      setLoading(true)
      try {
        const { invoices: data } = await getInvoices(currentWorkspace.id, 100)
        setInvoices(data)
      } catch (error) {
        console.error('Failed to load invoices:', error)
      } finally {
        setLoading(false)
      }
    }

    loadInvoices()
  }, [currentWorkspace?.id])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
        <PageHeader
          title="Invoices"
          description="View and manage all invoices for this workspace."
        />

        <div className="surface-card rounded-lg">
          <table className="w-full text-sm">
            <thead className="border-b-0 bg-muted/50">
              <tr>
                <th className="p-3 text-left font-medium">Type</th>
                <th className="p-3 text-left font-medium">Status</th>
                <th className="p-3 text-left font-medium">Total</th>
                <th className="p-3 text-left font-medium">Due Date</th>
                <th className="p-3 text-left font-medium">Issued</th>
                <th className="p-3 text-left font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    No invoices yet
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b-0 last:border-0 hover:bg-muted/50">
                    <td className="p-3 capitalize">{invoice.type.replace('_', ' ')}</td>
                    <td className="p-3">
                      <StatusBadge status={invoice.status} />
                    </td>
                    <td className="p-3 font-medium">
                      {formatMoney(invoice.total, invoice.currency)}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {invoice.due_date ?? '—'}
                    </td>
                    <td className="p-3 text-muted-foreground">
                      {invoice.issued_at
                        ? new Date(invoice.issued_at).toLocaleDateString()
                        : '—'}
                    </td>
                    <td className="p-3">
                      {invoice.hosted_url && (
                        <a
                          href={invoice.hosted_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary hover:underline cursor-pointer"
                        >
                          View
                        </a>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const colorMap: Record<string, string> = {
    paid: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
    past_due: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
    open: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
    draft: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
  }

  const color = colorMap[status] ?? colorMap.draft

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
