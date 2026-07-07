import { useEffect, useState } from 'react'
import { Card, CardEyebrow } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowLeftIcon, ArrowRightIcon } from '@/components/icons'
import { RevenueEntryDetailsSheet } from './RevenueEntryDetailsSheet'
import type { RevenueBreakdownItem } from '../types'

interface RevenueEntriesProps {
  items: RevenueBreakdownItem[]
  isLoading: boolean
  searchParams: URLSearchParams
  setSearchParams: (params: URLSearchParams) => void
}

const ITEMS_PER_PAGE = 10

const sourceStyles = {
  service: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 hover:bg-blue-500/10',
  deal: 'bg-green-500/10 text-green-700 dark:text-green-400 hover:bg-green-500/10',
  manual: 'bg-purple-500/10 text-purple-700 dark:text-purple-400 hover:bg-purple-500/10',
}

export function RevenueEntries({
  items,
  isLoading,
  searchParams,
  setSearchParams,
}: RevenueEntriesProps) {
  const currentPage = parseInt(searchParams.get('page') || '1', 10)
  const [selectedItem, setSelectedItem] = useState<RevenueBreakdownItem | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)

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

  const getSourceLabel = (source: RevenueBreakdownItem['source']) => {
    switch (source) {
      case 'service':
        return 'Service'
      case 'deal':
        return 'Deal'
      case 'manual':
        return 'Manual'
    }
  }

  // Items are already filtered by backend, just sort (newest first)
  const sortedItems = [...items].sort((a, b) => {
    const dateA = new Date(a.date).getTime()
    const dateB = new Date(b.date).getTime()
    return dateB - dateA // Descending order (newest first)
  })

  // Pagination
  const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE)
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE
  const endIndex = startIndex + ITEMS_PER_PAGE
  const currentItems = sortedItems.slice(startIndex, endIndex)

  const goToPage = (page: number) => {
    const newPage = Math.max(1, Math.min(page, totalPages))
    const newParams = new URLSearchParams(searchParams)
    newParams.set('page', newPage.toString())
    setSearchParams(newParams)
  }

  const handleRowClick = (item: RevenueBreakdownItem) => {
    setSelectedItem(item)
    setIsDetailOpen(true)
  }

  // Reset to page 1 when filters change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      const newParams = new URLSearchParams(searchParams)
      newParams.set('page', '1')
      setSearchParams(newParams)
    }
  }, [totalPages, currentPage, searchParams, setSearchParams])

  return (
    <div className="space-y-4">
      {/* Table */}
      <Card variant="table">
        <CardEyebrow variant="table" title="All Revenue Entries" />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">Name</TableHead>
              <TableHead className="text-[13px] font-medium">Type</TableHead>
              <TableHead className="text-[13px] font-medium">Date</TableHead>
              <TableHead className="pr-6 text-[13px] font-medium">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <>
                {[...Array(10)].map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <Skeleton className="h-[13px] w-40" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[18px] w-16 rounded-full" />
                    </TableCell>
                    <TableCell>
                      <Skeleton className="h-[13px] w-24" />
                    </TableCell>
                    <TableCell className="pr-6">
                      <Skeleton className="h-[13px] w-20" />
                    </TableCell>
                  </TableRow>
                ))}
              </>
            ) : sortedItems.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  No revenue entries found
                </TableCell>
              </TableRow>
            ) : (
              currentItems.map((item) => (
                <TableRow
                  key={item.id}
                  onClick={() => handleRowClick(item)}
                  className="cursor-pointer hover:bg-muted/50"
                >
                  <TableCell className="pl-6 text-[13px] font-medium">{item.name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className={`text-[11px] capitalize ${sourceStyles[item.source]}`}>
                      {getSourceLabel(item.source)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-[13px] text-muted-foreground">
                    {formatDate(item.date)}
                  </TableCell>
                  <TableCell className="pr-6 text-[13px] font-medium">
                    {formatCurrency(item.amount)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <p className="text-sm text-muted-foreground">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage - 1)}
              disabled={currentPage === 1}
              className="h-8 w-8 cursor-pointer p-0"
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => goToPage(currentPage + 1)}
              disabled={currentPage === totalPages}
              className="h-8 w-8 cursor-pointer p-0"
            >
              <ArrowRightIcon className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Sidebar */}
      <RevenueEntryDetailsSheet
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        entry={selectedItem}
        formatCurrency={formatCurrency}
        formatDate={formatDate}
      />
    </div>
  )
}
