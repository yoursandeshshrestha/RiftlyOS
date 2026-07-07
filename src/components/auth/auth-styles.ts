import { cn } from '@/lib/utils'

const fieldSurfaceClassName =
  'rounded-xl border border-border-subtle bg-surface text-foreground outline-none focus-visible:ring-0'

export const authInputClassName = cn(
  fieldSurfaceClassName,
  'h-11 w-full px-4 text-sm placeholder:text-muted-foreground',
)

export const authOAuthButtonClassName = 'w-full border-none shadow-xs'

export const authArrowSubmitButtonClassName =
  'absolute right-1.5 top-1/2 size-8 -translate-y-1/2 rounded-full cursor-pointer'

export const authChoiceButtonClassName = cn(
  authOAuthButtonClassName,
  'h-auto w-full justify-start gap-3 rounded-xl px-4 py-3.5 text-left',
)
