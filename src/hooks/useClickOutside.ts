import { useEffect, useRef, type RefObject } from 'react'

const DEFAULT_IGNORE_SELECTORS = [
  '[data-slot="combobox-content"]',
  '[data-slot="combobox-list"]',
  '[data-slot="combobox-positioner"]',
  '[data-slot="popover-content"]',
]

export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onOutside: () => void,
  enabled: boolean,
  ignoreSelectors: string[] = DEFAULT_IGNORE_SELECTORS,
) {
  const onOutsideRef = useRef(onOutside)
  onOutsideRef.current = onOutside

  useEffect(() => {
    if (!enabled) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return

      if (ref.current?.contains(target)) return

      if (target instanceof Element) {
        for (const selector of ignoreSelectors) {
          if (target.closest(selector)) return
        }
      }

      onOutsideRef.current()
    }

    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [ref, enabled, ignoreSelectors])
}
