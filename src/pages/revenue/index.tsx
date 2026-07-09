import { useState, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format, startOfMonth, endOfMonth, parseISO, subMonths } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { PlusIcon, TargetIcon, CalendarIcon } from '@/components/icons'
import { supabase } from '@/lib/supabase'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { formatDate, formatDateRangeShort, formatMonthYear } from '@/lib/date'
import { RevenueCards } from './components/RevenueCards'
import { RevenueProgress } from './components/RevenueProgress'
import { RevenueBreakdown } from './components/RevenueBreakdown'
import { RevenueEntries } from './components/RevenueEntries'
import { SetTargetDialog } from './components/SetTargetDialog'
import { AddEntryDialog } from './components/AddEntryDialog'
import { PageHeader } from '@/components/layout/PageHeader'
import { PageLayout } from '@/components/layout/PageLayout'
import type { RevenueMetrics, RevenueBreakdownItem, RevenueTarget, RevenueEntry } from './types'
import type { Service } from '@/pages/projects/types'
import type { Deal } from '@/pages/deals/types'
import type { DateRange } from 'react-day-picker'

export function RevenuePage() {
  const { activeWorkspace } = useWorkspace()
  const [searchParams, setSearchParams] = useSearchParams()

  // Initialize from URL params or defaults
  const [selectedMonth, setSelectedMonth] = useState<Date>(() => {
    const monthParam = searchParams.get('month')
    return monthParam ? parseISO(monthParam) : new Date()
  })
  const [dateRange, setDateRange] = useState<{ from?: Date; to?: Date }>(() => {
    const fromParam = searchParams.get('from')
    const toParam = searchParams.get('to')
    return {
      from: fromParam ? parseISO(fromParam) : undefined,
      to: toParam ? parseISO(toParam) : undefined,
    }
  })
  const [typeFilter, setTypeFilter] = useState<string>(searchParams.get('type') || 'all')
  const [metrics, setMetrics] = useState<RevenueMetrics>({
    totalMRR: 0,
    projectIncome: 0,
    otherIncome: 0,
    totalRevenue: 0,
    targetAmount: 0,
    progressPercentage: 0,
  })
  const [breakdownItems, setBreakdownItems] = useState<RevenueBreakdownItem[]>([])
  const [filteredBreakdownItems, setFilteredBreakdownItems] = useState<RevenueBreakdownItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isTargetDialogOpen, setIsTargetDialogOpen] = useState(false)
  const [isEntryDialogOpen, setIsEntryDialogOpen] = useState(false)
  const [currentTarget, setCurrentTarget] = useState<RevenueTarget | null>(null)

  // Update URL params when filters change
  useEffect(() => {
    const params = new URLSearchParams(searchParams)

    // Month
    params.set('month', format(selectedMonth, 'yyyy-MM-dd'))

    // Date range
    if (dateRange.from) {
      params.set('from', format(dateRange.from, 'yyyy-MM-dd'))
    } else {
      params.delete('from')
    }
    if (dateRange.to) {
      params.set('to', format(dateRange.to, 'yyyy-MM-dd'))
    } else {
      params.delete('to')
    }

    // Type filter
    if (typeFilter !== 'all') {
      params.set('type', typeFilter)
    } else {
      params.delete('type')
    }

    setSearchParams(params, { replace: true })
  }, [selectedMonth, dateRange, typeFilter])

  useEffect(() => {
    if (activeWorkspace?.id) {
      fetchRevenueData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspace?.id, selectedMonth])

  // Apply filters client-side for table only
  useEffect(() => {
    let filtered = breakdownItems

    // Apply date range filter
    if (dateRange.from) {
      filtered = filtered.filter((item) => {
        const itemDate = parseISO(item.date)
        if (dateRange.to) {
          return itemDate >= dateRange.from! && itemDate <= dateRange.to
        }
        return itemDate >= dateRange.from!
      })
    }

    // Apply type filter
    if (typeFilter !== 'all') {
      filtered = filtered.filter((item) => item.source === typeFilter)
    }

    setFilteredBreakdownItems(filtered)
  }, [breakdownItems, dateRange, typeFilter])

  const fetchRevenueData = async () => {
    if (!activeWorkspace?.id) return

    try {
      setIsLoading(true)
      const monthStart = format(startOfMonth(selectedMonth), 'yyyy-MM-dd')
      const monthEnd = format(endOfMonth(selectedMonth), 'yyyy-MM-dd')
      const monthKey = format(startOfMonth(selectedMonth), 'yyyy-MM-01')

      // Previous month dates for comparison
      const prevMonth = subMonths(selectedMonth, 1)
      const prevMonthStart = format(startOfMonth(prevMonth), 'yyyy-MM-dd')
      const prevMonthEnd = format(endOfMonth(prevMonth), 'yyyy-MM-dd')

      // Fetch all data for the selected month (no additional filters - filters applied client-side)
      const [servicesResult, dealsResult, entriesResult, targetResult, prevDealsResult, prevEntriesResult] = await Promise.all([
        // Fetch all active and paused project services (MRR - no date filter, they're ongoing)
        supabase
          .from('services')
          .select('*, projects!inner(status)')
          .eq('workspace_id', activeWorkspace.id)
          .in('projects.status', ['active', 'paused']),

        // Fetch closed won deals within the selected month
        supabase
          .from('deals')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .eq('stage', 'closed_won')
          .gte('closed_date', monthStart)
          .lte('closed_date', monthEnd),

        // Fetch manual revenue entries for the selected month
        supabase
          .from('revenue_entries')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .gte('entry_date', monthStart)
          .lte('entry_date', monthEnd),

        // Fetch revenue target for the selected month
        supabase
          .from('revenue_targets')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .eq('month', monthKey)
          .maybeSingle(),

        // Fetch previous month's deals for comparison
        supabase
          .from('deals')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .eq('stage', 'closed_won')
          .gte('closed_date', prevMonthStart)
          .lte('closed_date', prevMonthEnd),

        // Fetch previous month's entries for comparison
        supabase
          .from('revenue_entries')
          .select('*')
          .eq('workspace_id', activeWorkspace.id)
          .gte('entry_date', prevMonthStart)
          .lte('entry_date', prevMonthEnd),
      ])

      // Log any errors
      if (servicesResult.error) console.error('Services error:', servicesResult.error)
      if (dealsResult.error) console.error('Deals error:', dealsResult.error)
      if (entriesResult.error) console.error('Entries error:', entriesResult.error)
      if (targetResult.error) console.error('Target error:', targetResult.error)

      const services = (servicesResult.data || []) as Service[]
      const deals = (dealsResult.data || []) as Deal[]
      const entries = (entriesResult.data || []) as RevenueEntry[]
      const target = targetResult.data as RevenueTarget | null
      const prevDeals = (prevDealsResult.data || []) as Deal[]
      const prevEntries = (prevEntriesResult.data || []) as RevenueEntry[]

      console.log('Revenue data:', {
        workspace_id: activeWorkspace.id,
        monthStart,
        monthEnd,
        services: services.length,
        deals: deals.length,
        entries: entries.length,
        target,
      })

      setCurrentTarget(target)

      // Calculate metrics
      const totalMRR = services.reduce((sum, s) => sum + Number(s.mrr), 0)
      const serviceIncomeFromEntries = entries
        .filter(e => e.category === 'service_income')
        .reduce((sum, e) => sum + Number(e.amount), 0)
      const totalMRRWithEntries = totalMRR + serviceIncomeFromEntries

      const projectIncomeFromDeals = deals.reduce((sum, d) => sum + Number(d.deal_value), 0)
      const projectIncomeFromEntries = entries
        .filter(e => e.category === 'project_income')
        .reduce((sum, e) => sum + Number(e.amount), 0)
      const projectIncome = projectIncomeFromDeals + projectIncomeFromEntries

      const otherIncome = entries
        .filter(e => e.category === 'other')
        .reduce((sum, e) => sum + Number(e.amount), 0)

      const totalRevenue = totalMRRWithEntries + projectIncome + otherIncome
      const targetAmount = target ? Number(target.target_amount) : 0
      const progressPercentage = targetAmount > 0 ? (totalRevenue / targetAmount) * 100 : 0

      // Calculate previous month's revenue for comparison
      const prevServiceIncomeFromEntries = prevEntries
        .filter(e => e.category === 'service_income')
        .reduce((sum, e) => sum + Number(e.amount), 0)
      const prevTotalMRRWithEntries = totalMRR + prevServiceIncomeFromEntries

      const prevProjectIncomeFromDeals = prevDeals.reduce((sum, d) => sum + Number(d.deal_value), 0)
      const prevProjectIncomeFromEntries = prevEntries
        .filter(e => e.category === 'project_income')
        .reduce((sum, e) => sum + Number(e.amount), 0)
      const prevProjectIncome = prevProjectIncomeFromDeals + prevProjectIncomeFromEntries

      const prevOtherIncome = prevEntries
        .filter(e => e.category === 'other')
        .reduce((sum, e) => sum + Number(e.amount), 0)

      const prevTotalRevenue = prevTotalMRRWithEntries + prevProjectIncome + prevOtherIncome
      const revenueChange = prevTotalRevenue > 0 ? ((totalRevenue - prevTotalRevenue) / prevTotalRevenue) * 100 : 0

      // Calculate percentage changes for all metrics
      const mrrChange = prevTotalMRRWithEntries > 0
        ? ((totalMRRWithEntries - prevTotalMRRWithEntries) / prevTotalMRRWithEntries) * 100
        : 0
      const projectIncomeChange = prevProjectIncome > 0
        ? ((projectIncome - prevProjectIncome) / prevProjectIncome) * 100
        : 0
      const otherIncomeChange = prevOtherIncome > 0
        ? ((otherIncome - prevOtherIncome) / prevOtherIncome) * 100
        : 0

      setMetrics({
        totalMRR: totalMRRWithEntries,
        projectIncome,
        otherIncome,
        totalRevenue,
        targetAmount,
        progressPercentage,
        breakdown: {
          servicesMRR: totalMRR,
          serviceIncomeEntries: serviceIncomeFromEntries,
          dealsIncome: projectIncomeFromDeals,
          projectIncomeEntries: projectIncomeFromEntries,
          otherIncomeEntries: otherIncome,
        },
        comparison: {
          totalRevenue: {
            prevValue: prevTotalRevenue,
            currentValue: totalRevenue,
            changePercentage: revenueChange,
          },
          mrr: {
            prevValue: prevTotalMRRWithEntries,
            currentValue: totalMRRWithEntries,
            changePercentage: mrrChange,
          },
          projectIncome: {
            prevValue: prevProjectIncome,
            currentValue: projectIncome,
            changePercentage: projectIncomeChange,
          },
          otherIncome: {
            prevValue: prevOtherIncome,
            currentValue: otherIncome,
            changePercentage: otherIncomeChange,
          },
        },
      })

      // Build breakdown items
      const breakdown: RevenueBreakdownItem[] = [
        ...services.map(s => ({
          id: s.id,
          source: 'service' as const,
          name: s.name,
          amount: Number(s.mrr),
          date: s.created_at,
          description: `MRR (renews ${formatDate(s.renewal_date)})`,
        })),
        ...deals.map(d => ({
          id: d.id,
          source: 'deal' as const,
          name: d.prospect_name,
          amount: Number(d.deal_value),
          date: d.created_at,
          description: d.services,
        })),
        ...entries.map(e => ({
          id: e.id,
          source: 'manual' as const,
          name: e.description,
          amount: Number(e.amount),
          date: e.created_at,
          description: e.category,
        })),
      ]

      // Sort by date (newest first)
      breakdown.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      setBreakdownItems(breakdown)
    } catch (error) {
      console.error('Error fetching revenue data:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSaveTarget = async (amount: number) => {
    if (!activeWorkspace?.id) return

    const monthKey = format(startOfMonth(selectedMonth), 'yyyy-MM-01')

    try {
      if (currentTarget) {
        // Update existing target
        await supabase
          .from('revenue_targets')
          .update({ target_amount: amount } as never)
          .eq('id', currentTarget.id)
      } else {
        // Create new target
        await supabase
          .from('revenue_targets')
          .insert({
            workspace_id: activeWorkspace.id,
            month: monthKey,
            target_amount: amount,
          } as never)
      }

      await fetchRevenueData()
      setIsTargetDialogOpen(false)
    } catch (error) {
      console.error('Error saving target:', error)
      throw error
    }
  }

  const handleAddEntry = async (data: {
    amount: string
    description: string
    date: string
    category: 'service_income' | 'project_income' | 'other'
  }) => {
    if (!activeWorkspace?.id) return

    try {
      await supabase
        .from('revenue_entries')
        .insert({
          workspace_id: activeWorkspace.id,
          amount: parseFloat(data.amount),
          description: data.description,
          entry_date: data.date,
          category: data.category,
          created_by: (await supabase.auth.getUser()).data.user?.id,
        } as never)

      await fetchRevenueData()
      setIsEntryDialogOpen(false)
    } catch (error) {
      console.error('Error adding revenue entry:', error)
      throw error
    }
  }

  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange({ from: range?.from, to: range?.to })
  }

  const clearAllFilters = () => {
    setSelectedMonth(new Date())
    setDateRange({})
    setTypeFilter('all')

    // Clear URL params except page
    const params = new URLSearchParams()
    const currentPage = searchParams.get('page')
    if (currentPage) {
      params.set('page', currentPage)
    }
    params.set('month', format(new Date(), 'yyyy-MM-dd'))
    setSearchParams(params, { replace: true })
  }

  return (
    <PageLayout
      header={
        <PageHeader
          title="Revenue report"
          description="Monthly income from projects, deals, and manual entries"
        >
          <Button
            variant="outline"
            className="cursor-pointer"
            onClick={() => setIsTargetDialogOpen(true)}
          >
            <TargetIcon className="size-4" />
            Set Target
          </Button>
          <Button className="cursor-pointer" onClick={() => setIsEntryDialogOpen(true)}>
            <PlusIcon className="size-4" />
            Add Entry
          </Button>
        </PageHeader>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-10 w-full cursor-pointer justify-start gap-2 font-normal sm:w-48"
              >
                {formatMonthYear(selectedMonth)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-48">
              {Array.from({ length: 12 }, (_, i) => {
                const date = new Date()
                date.setMonth(date.getMonth() - i)
                return date
              }).map((date) => (
                <DropdownMenuItem
                  key={date.toISOString()}
                  onClick={() => setSelectedMonth(date)}
                  className="cursor-pointer"
                >
                  {formatMonthYear(date)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-10 w-full cursor-pointer justify-start gap-2 font-normal sm:w-56"
              >
                <CalendarIcon className="size-4 text-muted-foreground" />
                {dateRange?.from ? (
                  dateRange.to ? (
                    formatDateRangeShort(dateRange.from, dateRange.to)
                  ) : (
                    formatDate(dateRange.from)
                  )
                ) : (
                  <span>Date Range</span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="range"
                selected={{ from: dateRange.from, to: dateRange.to }}
                onSelect={handleDateRangeChange}
                numberOfMonths={2}
              />
            </PopoverContent>
          </Popover>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="h-10 w-full cursor-pointer justify-start gap-2 font-normal sm:w-40"
              >
                {typeFilter === 'all' ? 'Type' : typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={() => setTypeFilter('all')} className="cursor-pointer">
                All Types
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('service')} className="cursor-pointer">
                Service
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('deal')} className="cursor-pointer">
                Deal
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTypeFilter('manual')} className="cursor-pointer">
                Manual
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {format(selectedMonth, 'yyyy-MM') !== format(new Date(), 'yyyy-MM') && (
            <Button
              variant="outline"
              onClick={() => setSelectedMonth(new Date())}
              className="h-10 cursor-pointer"
            >
              Go to Current Month
            </Button>
          )}
          {(dateRange.from || typeFilter !== 'all') && (
            <Button
              variant="outline"
              onClick={clearAllFilters}
              className="h-10 w-32 cursor-pointer"
            >
              Clear All
            </Button>
          )}
        </div>

      <RevenueCards
        metrics={metrics}
        breakdown={
          metrics.breakdown || {
            servicesMRR: 0,
            serviceIncomeEntries: 0,
            dealsIncome: 0,
            projectIncomeEntries: 0,
            otherIncomeEntries: 0,
          }
        }
        isLoading={isLoading}
      />

      {/* Charts Grid */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-stretch">
        <RevenueProgress metrics={metrics} isLoading={isLoading} />
        <RevenueBreakdown items={breakdownItems} isLoading={isLoading} />
      </div>

      {/* Revenue Entries List */}
      <RevenueEntries
        items={filteredBreakdownItems}
        isLoading={isLoading}
        searchParams={searchParams}
        setSearchParams={setSearchParams}
      />

      {/* Dialogs */}
      <SetTargetDialog
        open={isTargetDialogOpen}
        onOpenChange={setIsTargetDialogOpen}
        currentTarget={currentTarget?.target_amount}
        onSave={handleSaveTarget}
      />
      <AddEntryDialog
        open={isEntryDialogOpen}
        onOpenChange={setIsEntryDialogOpen}
        onSave={handleAddEntry}
      />
    </PageLayout>
  )
}
