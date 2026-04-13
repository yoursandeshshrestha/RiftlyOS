import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {  Search, Plus } from 'lucide-react'

interface Activity {
  id: string
  project: string
  developer: string
  action: string
  status: 'success' | 'pending' | 'failed'
  date: string
  time: string
}

const activities: Activity[] = [
  {
    id: 'DEP-001',
    project: 'Mobile App',
    developer: 'Sarah Johnson',
    action: 'Deployed to Production',
    status: 'success',
    date: 'Apr 13, 2026',
    time: '10:30 AM',
  },
  {
    id: 'PR-042',
    project: 'Web Dashboard',
    developer: 'Mike Chen',
    action: 'PR #42: Auth refactor',
    status: 'pending',
    date: 'Apr 13, 2026',
    time: '09:15 AM',
  },
  {
    id: 'DEP-002',
    project: 'API Gateway',
    developer: 'Emma Wilson',
    action: 'Deployed to Staging',
    status: 'success',
    date: 'Apr 12, 2026',
    time: '04:45 PM',
  },
  {
    id: 'BUILD-123',
    project: 'Analytics Service',
    developer: 'James Taylor',
    action: 'Build Failed',
    status: 'failed',
    date: 'Apr 12, 2026',
    time: '02:20 PM',
  },
  {
    id: 'PR-041',
    project: 'Mobile App',
    developer: 'Lisa Anderson',
    action: 'PR #41: UI improvements',
    status: 'success',
    date: 'Apr 11, 2026',
    time: '11:00 AM',
  },
]

const statusStyles = {
  success: 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100',
  pending: 'bg-amber-100 text-amber-700 hover:bg-amber-100',
  failed: 'bg-red-100 text-red-700 hover:bg-red-100',
}

export function RecentTransactions() {
  return (
    <div className="rounded-xl border bg-muted/30 pb-1.5 pl-1.5 pr-1.5 pt-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <div className="text-[13px] font-medium text-muted-foreground/60">
          Recent Activity
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search activity..."
              className="h-9 w-[200px] cursor-text rounded-md pl-8 text-[13px]"
            />
          </div>
          <Button variant="outline" size="sm" className="h-9 cursor-pointer">
            <Plus className="mr-1.5 size-4" />
            New Deploy
          </Button>
         
        </div>
      </div>
      <Card className="rounded-lg border py-0 ring-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6 text-[13px] font-medium">ID</TableHead>
              <TableHead className="text-[13px] font-medium">Project</TableHead>
              <TableHead className="text-[13px] font-medium">Developer</TableHead>
              <TableHead className="text-[13px] font-medium">Action</TableHead>
              <TableHead className="text-[13px] font-medium">Status</TableHead>
              <TableHead className="text-[13px] font-medium">Date</TableHead>
              <TableHead className="pr-6 text-[13px] font-medium">Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {activities.map((activity) => (
              <TableRow key={activity.id} className="cursor-pointer">
                <TableCell className="pl-6 text-[13px] font-medium">{activity.id}</TableCell>
                <TableCell className="text-[13px]">{activity.project}</TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {activity.developer}
                </TableCell>
                <TableCell className="text-[13px] font-medium">{activity.action}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className={`text-[11px] ${statusStyles[activity.status]}`}>
                    {activity.status.charAt(0).toUpperCase() + activity.status.slice(1)}
                  </Badge>
                </TableCell>
                <TableCell className="text-[13px] text-muted-foreground">
                  {activity.date}
                </TableCell>
                <TableCell className="pr-6 text-[13px] text-muted-foreground">
                  {activity.time}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  )
}
