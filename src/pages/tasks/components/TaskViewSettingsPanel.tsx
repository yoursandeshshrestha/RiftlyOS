import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Calendar } from '@/components/ui/calendar'
import { FormCombobox } from '@/components/ui/form-combobox'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { PanelFormRow } from '@/components/layout/PanelFormRow'
import { CalendarIcon, FilterIcon, ListIcon, PipelineIcon } from '@/components/icons'
import { formatDateShort } from '@/lib/date'
import { cn } from '@/lib/utils'
import { taskPanelSubsectionClass } from './taskPanelStyles'
import {
  TASK_TABLE_COLUMNS,
  type TaskTableColumnKey,
  type TaskViewMode,
} from '../taskViewSettings'

import type { TaskColumn } from '../types'

interface Project {
  id: string
  name: string
}

interface Member {
  id: string
  full_name: string
}

interface TaskViewSettingsPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  canFilter: boolean
  viewMode: TaskViewMode
  onViewModeChange: (mode: TaskViewMode) => void
  showMyTasksOnly: boolean
  onShowMyTasksOnlyChange: (value: boolean) => void
  filterProject: string
  onFilterProjectChange: (value: string) => void
  filterStatus: string
  onFilterStatusChange: (value: string) => void
  filterPriority: string
  onFilterPriorityChange: (value: string) => void
  filterAssignee: string
  onFilterAssigneeChange: (value: string) => void
  filterDueDateFrom?: Date
  filterDueDateTo?: Date
  onFilterDueDateFromChange: (date?: Date) => void
  onFilterDueDateToChange: (date?: Date) => void
  projects: Project[]
  columns: TaskColumn[]
  members: Member[]
  activeFiltersCount: number
  onClearAll: () => void
  visibleColumns: TaskTableColumnKey[]
  onToggleColumn: (key: TaskTableColumnKey) => void
}

const comboboxClass = 'h-8 w-full border-border-table bg-background text-sm shadow-none'

function SettingsDivider() {
  return <div className="h-px bg-border-table" />
}

function DateFilterTrigger({
  value,
  placeholder,
  onSelect,
}: {
  value?: Date
  placeholder: string
  onSelect: (date?: Date) => void
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-sm border border-border-table bg-background px-2.5 text-sm transition-colors',
            value ? 'text-foreground' : 'text-muted-foreground',
            'hover:border-border hover:text-foreground',
          )}
        >
          <span className="truncate">{value ? formatDateShort(value) : placeholder}</span>
          <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="z-60 w-auto p-0" align="end">
        <Calendar mode="single" selected={value} onSelect={onSelect} />
      </PopoverContent>
    </Popover>
  )
}

export function TaskViewSettingsPanel({
  open,
  onOpenChange,
  canFilter,
  viewMode,
  onViewModeChange,
  showMyTasksOnly,
  onShowMyTasksOnlyChange,
  filterProject,
  onFilterProjectChange,
  filterStatus,
  onFilterStatusChange,
  filterPriority,
  onFilterPriorityChange,
  filterAssignee,
  onFilterAssigneeChange,
  filterDueDateFrom,
  filterDueDateTo,
  onFilterDueDateFromChange,
  onFilterDueDateToChange,
  projects,
  columns,
  members,
  activeFiltersCount,
  onClearAll,
  visibleColumns,
  onToggleColumn,
}: TaskViewSettingsPanelProps) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="relative cursor-pointer">
          <FilterIcon className="size-4" />
          Display
          {canFilter && activeFiltersCount > 0 && (
            <Badge
              variant="default"
              className="ml-2 flex size-5 items-center justify-center rounded-full p-0 text-[10px]"
            >
              {activeFiltersCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="z-50 w-[min(100vw-2rem,340px)] gap-0 overflow-hidden border-border-table p-0 shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-border-table bg-background px-4 py-3">
          <span className="text-sm font-medium text-foreground">Display</span>
          {canFilter && activeFiltersCount > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClearAll}
              className="h-auto cursor-pointer px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear all
            </Button>
          )}
        </div>

        <div className="space-y-3 bg-background px-4 py-3">
          <div className="flex rounded-md border border-border-table bg-muted/30 p-0.5">
            <button
              type="button"
              onClick={() => onViewModeChange('table')}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors',
                viewMode === 'table'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <ListIcon className="size-3.5" />
              Table
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('board')}
              className={cn(
                'flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-sm px-3 py-1.5 text-sm transition-colors',
                viewMode === 'board'
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <PipelineIcon className="size-3.5" />
              Board
            </button>
          </div>
        </div>

        {canFilter && (
          <>
            <SettingsDivider />
            <div className="space-y-2.5 bg-background px-4 py-3">
              <PanelFormRow label="Mine">
                <div className="flex h-8 items-center justify-end">
                  <Switch
                    checked={showMyTasksOnly}
                    onCheckedChange={onShowMyTasksOnlyChange}
                    size="sm"
                  />
                </div>
              </PanelFormRow>

              <PanelFormRow label="Project">
                <FormCombobox
                  value={filterProject}
                  onValueChange={onFilterProjectChange}
                  options={[
                    { value: 'all', label: 'All projects' },
                    { value: 'none', label: 'No project' },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                  placeholder="All projects"
                  className={comboboxClass}
                />
              </PanelFormRow>

              <PanelFormRow label="Status">
                <FormCombobox
                  value={filterStatus}
                  onValueChange={onFilterStatusChange}
                  options={[
                    { value: 'all', label: 'All statuses' },
                    ...columns.map((column) => ({ value: column.id, label: column.name })),
                  ]}
                  placeholder="All statuses"
                  className={comboboxClass}
                />
              </PanelFormRow>

              <PanelFormRow label="Priority">
                <FormCombobox
                  value={filterPriority}
                  onValueChange={onFilterPriorityChange}
                  options={[
                    { value: 'all', label: 'All priorities' },
                    { value: 'high', label: 'High' },
                    { value: 'medium', label: 'Medium' },
                    { value: 'low', label: 'Low' },
                  ]}
                  placeholder="All priorities"
                  className={comboboxClass}
                />
              </PanelFormRow>

              <PanelFormRow label="Assignee">
                <FormCombobox
                  value={filterAssignee}
                  onValueChange={onFilterAssigneeChange}
                  options={[
                    { value: 'all', label: 'All assignees' },
                    { value: 'unassigned', label: 'Unassigned' },
                    ...members.map((member) => ({ value: member.id, label: member.full_name })),
                  ]}
                  placeholder="All assignees"
                  className={comboboxClass}
                />
              </PanelFormRow>

              <PanelFormRow label="Due from">
                <DateFilterTrigger
                  value={filterDueDateFrom}
                  placeholder="Any date"
                  onSelect={onFilterDueDateFromChange}
                />
              </PanelFormRow>

              <PanelFormRow label="Due to">
                <DateFilterTrigger
                  value={filterDueDateTo}
                  placeholder="Any date"
                  onSelect={onFilterDueDateToChange}
                />
              </PanelFormRow>
            </div>
          </>
        )}

        {viewMode === 'table' && (
          <>
            <SettingsDivider />
            <div className={cn('px-4 py-3', taskPanelSubsectionClass)}>
              <p className="mb-2.5 text-sm text-muted-foreground">Display properties</p>
              <div className="flex flex-wrap gap-1.5">
                <span className="inline-flex h-7 items-center rounded-sm border border-border-table bg-background px-2.5 text-xs font-medium text-foreground">
                  Title
                </span>
                {TASK_TABLE_COLUMNS.map((col) => {
                  const active = visibleColumns.includes(col.key)
                  return (
                    <button
                      key={col.key}
                      type="button"
                      onClick={() => onToggleColumn(col.key)}
                      className={cn(
                        'inline-flex h-7 cursor-pointer items-center rounded-sm border px-2.5 text-xs font-medium transition-colors',
                        active
                          ? 'border-border-table bg-background text-foreground'
                          : 'border-transparent bg-transparent text-muted-foreground hover:border-border-table hover:bg-background/60 hover:text-foreground',
                      )}
                    >
                      {col.label}
                    </button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
