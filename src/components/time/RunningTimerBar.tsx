import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ClockIcon } from '@/components/icons'
import { useAuth } from '@/contexts/AuthContext'
import { useWorkspace } from '@/contexts/WorkspaceContext'
import { getRunningTimerForUser, stopTimer, type RunningTimer } from '@/lib/time/entries'
import { formatElapsedClock } from '@/lib/time/format'
import { Button } from '@/components/ui/button'

export function RunningTimerBar() {
  const { user } = useAuth()
  const { activeWorkspace, userRole } = useWorkspace()
  const navigate = useNavigate()
  const [timer, setTimer] = useState<RunningTimer | null>(null)
  const [tick, setTick] = useState(0)
  const [isStopping, setIsStopping] = useState(false)

  const isStaff = userRole === 'owner' || userRole === 'employee'

  const loadTimer = useCallback(async () => {
    if (!user?.id || !activeWorkspace?.id || !isStaff) {
      setTimer(null)
      return
    }
    try {
      const running = await getRunningTimerForUser(user.id, activeWorkspace.id)
      setTimer(running)
    } catch {
      setTimer(null)
    }
  }, [user?.id, activeWorkspace?.id, isStaff])

  useEffect(() => {
    loadTimer()
  }, [loadTimer])

  useEffect(() => {
    const handler = () => loadTimer()
    window.addEventListener('time-entry-changed', handler)
    return () => window.removeEventListener('time-entry-changed', handler)
  }, [loadTimer])

  useEffect(() => {
    if (!timer?.started_at) return
    const interval = setInterval(() => setTick((t) => t + 1), 1000)
    return () => clearInterval(interval)
  }, [timer?.started_at])

  const handleStop = async () => {
    if (!user || !timer) return
    setIsStopping(true)
    try {
      await stopTimer(timer.task_id, user.id)
      setTimer(null)
      window.dispatchEvent(new CustomEvent('time-entry-changed'))
    } finally {
      setIsStopping(false)
    }
  }

  if (!isStaff || !timer?.started_at) return null

  void tick

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-lg border bg-background px-4 py-3 shadow-lg">
      <ClockIcon className="size-4 text-green-600 dark:text-green-400" />
      <button
        type="button"
        onClick={() => navigate('/tasks')}
        className="text-left cursor-pointer hover:underline"
      >
        <p className="text-xs text-muted-foreground">Timer running</p>
        <p className="max-w-[200px] truncate text-sm font-medium">{timer.task?.title ?? 'Task'}</p>
        <p className="font-mono text-sm text-green-700 dark:text-green-400">
          {formatElapsedClock(timer.started_at)}
        </p>
      </button>
      <Button
        size="sm"
        variant="destructive"
        disabled={isStopping}
        onClick={handleStop}
        className="cursor-pointer"
      >
        Stop
      </Button>
    </div>
  )
}
