import type { InvoiceListItem } from './invoices'
import type { RetainerListItem } from './subscriptions'

export const FINANCE_PAGE_SIZE = 10

function matchesSearch(
  query: string,
  fields: Array<string | null | undefined>,
): boolean {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return true

  return fields.some((field) => field?.toLowerCase().includes(normalized))
}

export function filterInvoices(
  invoices: InvoiceListItem[],
  options: {
    search?: string
    status?: string
    type?: string
  },
): InvoiceListItem[] {
  return invoices.filter((invoice) => {
    if (options.status && options.status !== 'all' && invoice.status !== options.status) {
      return false
    }

    if (options.type && options.type !== 'all' && invoice.type !== options.type) {
      return false
    }

    return matchesSearch(options.search ?? '', [
      invoice.clientName,
      invoice.clientEmail,
      invoice.billingEmail,
      invoice.description,
    ])
  })
}

export function filterRetainers(
  retainers: RetainerListItem[],
  options: {
    search?: string
    status?: string
  },
): RetainerListItem[] {
  return retainers.filter((retainer) => {
    if (options.status && options.status !== 'all') {
      if (options.status === 'paused') {
        if (!retainer.billing_paused) return false
      } else if (retainer.status !== options.status) {
        return false
      }
    }

    return matchesSearch(options.search ?? '', [
      retainer.clientName,
      retainer.clientEmail,
      retainer.billingEmail,
      retainer.description,
    ])
  })
}

export function paginateItems<T>(items: T[], page: number, pageSize = FINANCE_PAGE_SIZE): T[] {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function getTotalPages(count: number, pageSize = FINANCE_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(count / pageSize))
}
