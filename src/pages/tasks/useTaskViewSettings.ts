import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  loadTaskViewPreferences,
  saveTaskViewPreferences,
} from '@/lib/tasks/viewPreferences'
import {
  clearTaskViewFilters,
  DEFAULT_TASK_VIEW_SETTINGS,
  formatSettingsDate,
  getActiveFiltersCount,
  hasTaskViewUrlParams,
  mergeTaskViewSettings,
  parseSettingsDate,
  parseTaskViewSettingsFromUrl,
  serializeTaskViewSettingsToUrl,
  type TaskTableColumnKey,
  type TaskViewMode,
  type TaskViewSettings,
} from './taskViewSettings'

export function useTaskViewSettings(
  workspaceId: string | undefined,
  userId: string | undefined,
) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [settings, setSettings] = useState<TaskViewSettings>(DEFAULT_TASK_VIEW_SETTINGS)
  const [isReady, setIsReady] = useState(false)
  const skipUrlSyncRef = useRef(false)
  const skipSaveRef = useRef(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!workspaceId || !userId) return

    let cancelled = false

    const hydrate = async () => {
      setIsReady(false)
      skipUrlSyncRef.current = true
      skipSaveRef.current = true

      try {
        let next = { ...DEFAULT_TASK_VIEW_SETTINGS }

        if (hasTaskViewUrlParams(searchParams)) {
          next = mergeTaskViewSettings(next, parseTaskViewSettingsFromUrl(searchParams))
        } else {
          const saved = await loadTaskViewPreferences(workspaceId, userId)
          if (saved) next = saved
        }

        if (!cancelled) {
          setSettings(next)
          setIsReady(true)
        }
      } catch (err) {
        console.error('Failed to load task view settings:', err)
        if (!cancelled) {
          setSettings(DEFAULT_TASK_VIEW_SETTINGS)
          setIsReady(true)
        }
      } finally {
        if (!cancelled) {
          requestAnimationFrame(() => {
            skipUrlSyncRef.current = false
            skipSaveRef.current = false
          })
        }
      }
    }

    void hydrate()

    return () => {
      cancelled = true
    }
  }, [workspaceId, userId]) // eslint-disable-line react-hooks/exhaustive-deps -- hydrate once per workspace/user

  useEffect(() => {
    if (!isReady || skipUrlSyncRef.current) return

    const nextParams = serializeTaskViewSettingsToUrl(settings, searchParams)
    const current = searchParams.toString()
    const serialized = nextParams.toString()
    if (current !== serialized) {
      setSearchParams(nextParams, { replace: true })
    }
  }, [settings, isReady, searchParams, setSearchParams])

  useEffect(() => {
    if (!isReady || !workspaceId || !userId || skipSaveRef.current) return

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(() => {
      void saveTaskViewPreferences(workspaceId, userId, settings).catch((err) => {
        console.error('Failed to save task view settings:', err)
      })
    }, 400)

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    }
  }, [settings, isReady, workspaceId, userId])

  const updateSettings = useCallback((patch: Partial<TaskViewSettings>) => {
    setSettings((prev) => mergeTaskViewSettings(prev, patch))
  }, [])

  const setViewMode = useCallback((viewMode: TaskViewMode) => {
    updateSettings({ viewMode })
  }, [updateSettings])

  const setShowMyTasksOnly = useCallback((showMyTasksOnly: boolean) => {
    updateSettings({ showMyTasksOnly })
  }, [updateSettings])

  const setFilterProject = useCallback((filterProject: string) => {
    updateSettings({ filterProject })
  }, [updateSettings])

  const setFilterStatus = useCallback((filterStatus: string) => {
    updateSettings({ filterStatus })
  }, [updateSettings])

  const setFilterPriority = useCallback((filterPriority: string) => {
    updateSettings({ filterPriority })
  }, [updateSettings])

  const setFilterAssignee = useCallback((filterAssignee: string) => {
    updateSettings({ filterAssignee })
  }, [updateSettings])

  const setFilterDueDateFrom = useCallback((date?: Date) => {
    updateSettings({ filterDueDateFrom: formatSettingsDate(date) })
  }, [updateSettings])

  const setFilterDueDateTo = useCallback((date?: Date) => {
    updateSettings({ filterDueDateTo: formatSettingsDate(date) })
  }, [updateSettings])

  const toggleColumn = useCallback((key: TaskTableColumnKey) => {
    setSettings((prev) => {
      const has = prev.visibleColumns.includes(key)
      if (has && prev.visibleColumns.length <= 1) return prev

      const visibleColumns = has
        ? prev.visibleColumns.filter((c) => c !== key)
        : [...prev.visibleColumns, key].sort(
            (a, b) =>
              DEFAULT_TASK_VIEW_SETTINGS.visibleColumns.indexOf(a) -
              DEFAULT_TASK_VIEW_SETTINGS.visibleColumns.indexOf(b),
          )

      return { ...prev, visibleColumns }
    })
  }, [])

  const clearAllFilters = useCallback(() => {
    setSettings((prev) => clearTaskViewFilters(prev))
  }, [])

  return {
    settings,
    isReady,
    viewMode: settings.viewMode,
    showMyTasksOnly: settings.showMyTasksOnly,
    filterProject: settings.filterProject,
    filterStatus: settings.filterStatus,
    filterPriority: settings.filterPriority,
    filterAssignee: settings.filterAssignee,
    filterDueDateFrom: parseSettingsDate(settings.filterDueDateFrom),
    filterDueDateTo: parseSettingsDate(settings.filterDueDateTo),
    visibleColumns: settings.visibleColumns,
    activeFiltersCount: getActiveFiltersCount(settings),
    setViewMode,
    setShowMyTasksOnly,
    setFilterProject,
    setFilterStatus,
    setFilterPriority,
    setFilterAssignee,
    setFilterDueDateFrom,
    setFilterDueDateTo,
    toggleColumn,
    clearAllFilters,
  }
}
