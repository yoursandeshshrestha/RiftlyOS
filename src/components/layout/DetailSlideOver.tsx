import { type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const PANEL_PRESETS = {
  520: { widthClass: 'lg:w-[520px]', paddingClass: 'lg:pr-[560px]' },
  500: { widthClass: 'lg:w-[500px]', paddingClass: 'lg:pr-[540px]' },
} as const

type PanelWidth = keyof typeof PANEL_PRESETS

interface DetailSlideOverProps {
  open: boolean
  mounted: boolean
  children: ReactNode
  width?: PanelWidth
  className?: string
}

export function DetailSlideOver({
  open,
  mounted,
  children,
  width = 520,
  className,
}: DetailSlideOverProps) {
  const preset = PANEL_PRESETS[width]

  if (!mounted) return null

  return (
    <div
      className={cn(
        'fixed z-30 overflow-hidden bg-background shadow-xl transition-transform duration-300 ease-in-out',
        'inset-0 border-border-table lg:inset-y-0 lg:right-0 lg:left-auto lg:border-l',
        preset.widthClass,
        open ? 'translate-x-0' : 'translate-x-full',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function detailPanelPaddingClass(open: boolean, width: PanelWidth = 520): string {
  if (!open) return ''
  return PANEL_PRESETS[width].paddingClass
}
