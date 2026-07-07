import { format, isValid, parseISO } from 'date-fns'

const EMPTY = '—'

export function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return isValid(value) ? value : null

  // Date-only values (e.g. due_date) — parse at local noon to avoid timezone shifts
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = parseISO(`${value}T12:00:00`)
    return isValid(date) ? date : null
  }

  const parsed = parseISO(value)
  if (isValid(parsed)) return parsed

  const fallback = new Date(value)
  return isValid(fallback) ? fallback : null
}

/** e.g. 9 Mar 2026 */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  return format(date, 'd MMM yyyy')
}

/** e.g. 10:00 AM */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  return format(date, 'h:mm a')
}

/** e.g. 9 Mar 2026, 10:00 AM */
export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  return format(date, 'd MMM yyyy, h:mm a')
}

/** e.g. March 2026 */
export function formatMonthYear(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  return format(date, 'MMMM yyyy')
}

/** e.g. 9 Mar */
export function formatDateShort(value: string | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY
  return format(date, 'd MMM')
}

/** e.g. 9 Mar 2026 - 15 Apr 2026 */
export function formatDateRange(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  const fromDate = toDate(from)
  const toDateValue = toDate(to)
  if (!fromDate) return EMPTY
  if (!toDateValue) return formatDate(fromDate)
  return `${formatDate(fromDate)} - ${formatDate(toDateValue)}`
}

/** e.g. 9 Mar - 15 Apr */
export function formatDateRangeShort(
  from: string | Date | null | undefined,
  to: string | Date | null | undefined,
): string {
  const fromDate = toDate(from)
  const toDateValue = toDate(to)
  if (!fromDate) return EMPTY
  if (!toDateValue) return formatDateShort(fromDate)
  return `${formatDateShort(fromDate)} - ${formatDateShort(toDateValue)}`
}

/** ISO date string for API / form values (yyyy-MM-dd) */
export function toISODateString(value: Date): string {
  return format(value, 'yyyy-MM-dd')
}
