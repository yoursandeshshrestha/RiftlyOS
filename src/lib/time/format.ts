/** Format minutes as "2h 30m" or "45m" */
export function formatDuration(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0m'
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

/** Parse manual time input — supports 3h 30m, 3h, 45m, 1:30, 1.5h, 90 */
export function parseDurationInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase()
  if (!trimmed) return 0

  const colonMatch = trimmed.match(/^(\d+):(\d{1,2})(?::\d{1,2})?$/)
  if (colonMatch) {
    const hours = parseInt(colonMatch[1], 10)
    const minutes = parseInt(colonMatch[2], 10)
    if (minutes >= 60) return null
    return hours * 60 + minutes
  }

  const decimalHours = trimmed.match(/^(\d+(?:\.\d+)?)\s*h(?:ours?)?$/)
  if (decimalHours) {
    return Math.round(parseFloat(decimalHours[1]) * 60)
  }

  const hoursMinutes = trimmed.match(
    /^(\d+)\s*h(?:ours?)?(?:\s*(\d+)\s*m(?:in(?:ute)?s?)?)?$/,
  )
  if (hoursMinutes) {
    const hours = parseInt(hoursMinutes[1], 10)
    const minutes = hoursMinutes[2] ? parseInt(hoursMinutes[2], 10) : 0
    return hours * 60 + minutes
  }

  const minutesOnly = trimmed.match(/^(\d+)\s*m(?:in(?:ute)?s?)?$/)
  if (minutesOnly) return parseInt(minutesOnly[1], 10)

  const plainNumber = trimmed.match(/^(\d+)$/)
  if (plainNumber) return parseInt(plainNumber[1], 10)

  return null
}

/** Estimate display — prefers hours shorthand (0h, 2h, 1h 30m) */
export function formatEstimate(totalMinutes: number): string {
  if (totalMinutes <= 0) return '0h'
  return formatDuration(totalMinutes)
}

/** Live elapsed time from a started_at timestamp */
export function getElapsedMinutes(startedAt: string, now = Date.now()): number {
  const start = new Date(startedAt).getTime()
  return Math.max(0, Math.round((now - start) / 60000))
}

/** Table display: "2 hr of 4 hr" — returns null when neither logged nor estimate is set */
export function formatTimeVsEstimate(
  loggedMinutes: number,
  estimateMinutes: number | null | undefined,
): string | null {
  const estimate = estimateMinutes ?? 0
  const hasLogged = loggedMinutes > 0
  const hasEstimate = estimate > 0

  if (!hasLogged && !hasEstimate) return null

  const formatPart = (minutes: number): string => {
    if (minutes <= 0) return '0 hr'
    const hours = Math.floor(minutes / 60)
    const mins = minutes % 60
    if (hours === 0) return `${mins}m`
    if (mins === 0) return `${hours} hr`
    return `${hours} hr ${mins}m`
  }

  if (hasEstimate) {
    return `${formatPart(loggedMinutes)} of ${formatPart(estimate)}`
  }

  return formatPart(loggedMinutes)
}

export function formatElapsedClock(startedAt: string, now = Date.now()): string {
  const start = new Date(startedAt).getTime()
  const totalSeconds = Math.max(0, Math.floor((now - start) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}
