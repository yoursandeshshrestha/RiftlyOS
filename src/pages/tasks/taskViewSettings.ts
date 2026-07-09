import { parseISO, isValid } from 'date-fns'

export type TaskViewMode = 'board' | 'table'

export type TaskTableColumnKey =
  | 'status'
  | 'project'
  | 'priority'
  | 'assignees'
  | 'labels'
  | 'time'
  | 'due'

export const TASK_TABLE_COLUMNS: { key: TaskTableColumnKey; label: string }[] = [
  { key: 'status', label: 'Status' },
  { key: 'project', label: 'Project' },
  { key: 'priority', label: 'Priority' },
  { key: 'assignees', label: 'Assignees' },
  { key: 'labels', label: 'Labels' },
  { key: 'time', label: 'Time' },
  { key: 'due', label: 'Due' },
]

export const DEFAULT_VISIBLE_COLUMNS: TaskTableColumnKey[] = TASK_TABLE_COLUMNS.map((c) => c.key)

export interface TaskViewSettings {
  viewMode: TaskViewMode
  showMyTasksOnly: boolean
  filterProject: string
  filterStatus: string
  filterPriority: string
  filterAssignee: string
  filterDueDateFrom?: string
  filterDueDateTo?: string
  visibleColumns: TaskTableColumnKey[]
}

export const DEFAULT_TASK_VIEW_SETTINGS: TaskViewSettings = {
  viewMode: 'board',
  showMyTasksOnly: false,
  filterProject: 'all',
  filterStatus: 'all',
  filterPriority: 'all',
  filterAssignee: 'all',
  filterDueDateFrom: undefined,
  filterDueDateTo: undefined,
  visibleColumns: [...DEFAULT_VISIBLE_COLUMNS],
}

const URL_KEYS = [
  'view',
  'mine',
  'project',
  'status',
  'priority',
  'assignee',
  'due_from',
  'due_to',
  'cols',
] as const

const VALID_VIEW_MODES = new Set<TaskViewMode>(['board', 'table'])
const VALID_PRIORITIES = new Set(['all', 'high', 'medium', 'low'])
const VALID_COLUMN_KEYS = new Set<TaskTableColumnKey>(DEFAULT_VISIBLE_COLUMNS)

function parseDateParam(value: string | null): string | undefined {
  if (!value) return undefined
  const parsed = parseISO(value)
  return isValid(parsed) ? value : undefined
}

function parseVisibleColumns(value: string | null): TaskTableColumnKey[] | undefined {
  if (!value) return undefined
  const cols = value
    .split(',')
    .map((c) => c.trim())
    .filter((c): c is TaskTableColumnKey => VALID_COLUMN_KEYS.has(c as TaskTableColumnKey))
  return cols.length > 0 ? cols : undefined
}

export function hasTaskViewUrlParams(params: URLSearchParams): boolean {
  return URL_KEYS.some((key) => params.has(key))
}

export function parseTaskViewSettingsFromUrl(params: URLSearchParams): Partial<TaskViewSettings> {
  const result: Partial<TaskViewSettings> = {}

  const view = params.get('view')
  if (view && VALID_VIEW_MODES.has(view as TaskViewMode)) {
    result.viewMode = view as TaskViewMode
  }

  if (params.has('mine')) {
    result.showMyTasksOnly = params.get('mine') === '1'
  }

  const project = params.get('project')
  if (project) result.filterProject = project

  const status = params.get('status')
  if (status) result.filterStatus = status

  const priority = params.get('priority')
  if (priority && VALID_PRIORITIES.has(priority)) {
    result.filterPriority = priority
  }

  const assignee = params.get('assignee')
  if (assignee) result.filterAssignee = assignee

  const dueFrom = parseDateParam(params.get('due_from'))
  if (dueFrom) result.filterDueDateFrom = dueFrom

  const dueTo = parseDateParam(params.get('due_to'))
  if (dueTo) result.filterDueDateTo = dueTo

  const cols = parseVisibleColumns(params.get('cols'))
  if (cols) result.visibleColumns = cols

  return result
}

export function serializeTaskViewSettingsToUrl(
  settings: TaskViewSettings,
  current: URLSearchParams,
): URLSearchParams {
  const params = new URLSearchParams(current)

  if (settings.viewMode === 'board') {
    params.delete('view')
  } else {
    params.set('view', settings.viewMode)
  }

  if (settings.showMyTasksOnly) {
    params.set('mine', '1')
  } else {
    params.delete('mine')
  }

  if (settings.filterProject === 'all') {
    params.delete('project')
  } else {
    params.set('project', settings.filterProject)
  }

  if (settings.filterStatus === 'all') {
    params.delete('status')
  } else {
    params.set('status', settings.filterStatus)
  }

  if (settings.filterPriority === 'all') {
    params.delete('priority')
  } else {
    params.set('priority', settings.filterPriority)
  }

  if (settings.filterAssignee === 'all') {
    params.delete('assignee')
  } else {
    params.set('assignee', settings.filterAssignee)
  }

  if (settings.filterDueDateFrom) {
    params.set('due_from', settings.filterDueDateFrom)
  } else {
    params.delete('due_from')
  }

  if (settings.filterDueDateTo) {
    params.set('due_to', settings.filterDueDateTo)
  } else {
    params.delete('due_to')
  }

  const defaultCols = DEFAULT_VISIBLE_COLUMNS.join(',')
  const currentCols = settings.visibleColumns.join(',')
  if (currentCols === defaultCols) {
    params.delete('cols')
  } else {
    params.set('cols', currentCols)
  }

  return params
}

export function mergeTaskViewSettings(
  base: TaskViewSettings,
  partial: Partial<TaskViewSettings>,
): TaskViewSettings {
  return {
    ...base,
    ...partial,
    visibleColumns: partial.visibleColumns ?? base.visibleColumns,
  }
}

export function normalizeTaskViewSettings(raw: unknown): TaskViewSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_TASK_VIEW_SETTINGS }

  const data = raw as Record<string, unknown>
  const visibleColumns = Array.isArray(data.visibleColumns)
    ? data.visibleColumns.filter(
        (c): c is TaskTableColumnKey =>
          typeof c === 'string' && VALID_COLUMN_KEYS.has(c as TaskTableColumnKey),
      )
  : DEFAULT_VISIBLE_COLUMNS

  return mergeTaskViewSettings(DEFAULT_TASK_VIEW_SETTINGS, {
    viewMode:
      typeof data.viewMode === 'string' && VALID_VIEW_MODES.has(data.viewMode as TaskViewMode)
        ? (data.viewMode as TaskViewMode)
        : DEFAULT_TASK_VIEW_SETTINGS.viewMode,
    showMyTasksOnly: Boolean(data.showMyTasksOnly),
    filterProject:
      typeof data.filterProject === 'string' ? data.filterProject : DEFAULT_TASK_VIEW_SETTINGS.filterProject,
    filterStatus:
      typeof data.filterStatus === 'string' ? data.filterStatus : DEFAULT_TASK_VIEW_SETTINGS.filterStatus,
    filterPriority:
      typeof data.filterPriority === 'string' && VALID_PRIORITIES.has(data.filterPriority)
        ? data.filterPriority
        : DEFAULT_TASK_VIEW_SETTINGS.filterPriority,
    filterAssignee:
      typeof data.filterAssignee === 'string' ? data.filterAssignee : DEFAULT_TASK_VIEW_SETTINGS.filterAssignee,
    filterDueDateFrom:
      typeof data.filterDueDateFrom === 'string'
        ? parseDateParam(data.filterDueDateFrom)
        : undefined,
    filterDueDateTo:
      typeof data.filterDueDateTo === 'string' ? parseDateParam(data.filterDueDateTo) : undefined,
    visibleColumns: visibleColumns.length > 0 ? visibleColumns : DEFAULT_VISIBLE_COLUMNS,
  })
}

export function getActiveFiltersCount(settings: TaskViewSettings): number {
  let count = 0
  if (settings.showMyTasksOnly) count++
  if (settings.filterProject !== 'all') count++
  if (settings.filterStatus !== 'all') count++
  if (settings.filterPriority !== 'all') count++
  if (settings.filterAssignee !== 'all') count++
  if (settings.filterDueDateFrom || settings.filterDueDateTo) count++
  return count
}

export function clearTaskViewFilters(settings: TaskViewSettings): TaskViewSettings {
  return {
    ...settings,
    showMyTasksOnly: false,
    filterProject: 'all',
    filterStatus: 'all',
    filterPriority: 'all',
    filterAssignee: 'all',
    filterDueDateFrom: undefined,
    filterDueDateTo: undefined,
  }
}

export function parseSettingsDate(value?: string): Date | undefined {
  if (!value) return undefined
  const parsed = parseISO(value)
  return isValid(parsed) ? parsed : undefined
}

export function formatSettingsDate(date?: Date): string | undefined {
  if (!date) return undefined
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
