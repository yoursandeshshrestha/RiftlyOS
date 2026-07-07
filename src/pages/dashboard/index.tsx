import { useState } from 'react'
import { StatsCards } from './components/StatsCards'
import { SalesTrend } from './components/SalesTrend'
import { RevenueBreakdown } from './components/RevenueBreakdown'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { CalendarIcon, DownloadIcon } from '@/components/icons'
import { formatDateRange } from '@/lib/date'
import type { DateRange } from 'react-day-picker'

export function DashboardPage() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(2024, 10, 1),
    to: new Date(),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Welcome back! Here's an overview of your projects and team activity."
      >
        <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="cursor-pointer whitespace-nowrap font-normal">
                <CalendarIcon className="size-4" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    formatDateRange(dateRange.from, dateRange.to)
                  ) : (
                    formatDateRange(dateRange.from, null)
                  )
                ) : (
                  <span>Pick a date range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="end">
              <Calendar
                mode="range"
                selected={dateRange}
                onSelect={setDateRange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>

        <Button className="cursor-pointer whitespace-nowrap">
          <DownloadIcon className="size-4" />
          Export CSV
        </Button>
      </PageHeader>

      {/* Stats Cards */}
      <StatsCards />

      {/* Sales Trend & Revenue Breakdown */}
      <div className="grid gap-4 lg:grid-cols-3 lg:items-stretch">
        <div className="h-full lg:col-span-2">
          <SalesTrend />
        </div>
        <div className="h-full lg:col-span-1">
          <RevenueBreakdown />
        </div>
      </div>
    </div>
  )
}
