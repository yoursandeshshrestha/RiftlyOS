import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

type FinanceListPrefix = 'invoice' | 'retainer'

export function useFinanceListParams(prefix: FinanceListPrefix) {
  const [searchParams, setSearchParams] = useSearchParams()

  const qKey = `${prefix}_q`
  const statusKey = `${prefix}_status`
  const typeKey = `${prefix}_type`
  const pageKey = `${prefix}_page`

  const q = searchParams.get(qKey) ?? ''
  const status = searchParams.get(statusKey) ?? 'all'
  const type = prefix === 'invoice' ? (searchParams.get(typeKey) ?? 'all') : 'all'
  const page = Math.max(1, parseInt(searchParams.get(pageKey) ?? '1', 10) || 1)

  const updateParams = useCallback(
    (updates: Record<string, string | null>, resetPage = false) => {
      const next = new URLSearchParams(searchParams)

      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === 'all') {
          next.delete(key)
        } else {
          next.set(key, value)
        }
      }

      if (resetPage) {
        next.delete(pageKey)
      }

      setSearchParams(next, { replace: true })
    },
    [pageKey, searchParams, setSearchParams],
  )

  const setPage = useCallback(
    (nextPage: number) => {
      updateParams({ [pageKey]: String(Math.max(1, nextPage)) })
    },
    [pageKey, updateParams],
  )

  return {
    q,
    status,
    type,
    page,
    setSearch: (value: string) => updateParams({ [qKey]: value }, true),
    setStatus: (value: string) => updateParams({ [statusKey]: value }, true),
    setType: (value: string) => updateParams({ [typeKey]: value }, true),
    setPage,
  }
}
