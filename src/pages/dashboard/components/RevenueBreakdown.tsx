import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { DollarSign, Calendar as CalendarIcon, ChevronDown } from 'lucide-react'
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { format } from 'date-fns'
import type { DateRange } from 'react-day-picker'

const revenueData = [
  { name: 'Products', value: 45, color: '#3b82f6' },
  { name: 'Services', value: 30, color: '#10b981' },
  { name: 'Subscriptions', value: 15, color: '#f59e0b' },
  { name: 'Other', value: 10, color: '#8b5cf6' },
]

export function RevenueBreakdown() {
  const [dateRange, setDateRange] = useState<DateRange | undefined>({
    from: new Date(2024, 0, 1),
    to: new Date(2024, 7, 30),
  })

  return (
    <div className="flex h-full flex-col rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-start justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Revenue Breakdown
        </div>
        <div className="text-muted-foreground/40">
          <DollarSign className="size-4" />
        </div>
      </div>
      <Card className="flex-1 rounded-lg border px-4 pb-6 pt-6 ring-0">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-muted-foreground">Revenue by Category</h3>
            <p className="mt-1 text-2xl font-semibold">$20,320</p>
          </div>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="cursor-pointer font-normal">
                <CalendarIcon className="mr-2 size-4" />
                {dateRange?.from && dateRange?.to ? (
                  <>
                    {format(dateRange.from, 'MMM d')} - {format(dateRange.to, 'MMM d')}
                  </>
                ) : (
                  <span>Pick dates</span>
                )}
                <ChevronDown className="ml-2 size-4" />
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
        </div>
        <ResponsiveContainer width="100%" height={180}>
          <PieChart>
            <Pie
              data={revenueData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={90}
              paddingAngle={2}
              dataKey="value"
            >
              {revenueData.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '12px',
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="mt-4 space-y-2">
          {revenueData.map((item) => (
            <div key={item.name} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: item.color }}
                />
                <span className="text-[13px] text-muted-foreground">{item.name}</span>
              </div>
              <span className="text-[13px] font-medium">{item.value}%</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
