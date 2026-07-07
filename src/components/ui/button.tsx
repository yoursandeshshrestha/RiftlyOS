import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"
import { Spinner } from "./spinner"

const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80 [&_img]:!brightness-0 [&_img]:!invert",
        outline:
          "border-[0.5px] border-border-subtle bg-surface text-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-0 aria-expanded:bg-muted aria-expanded:text-foreground",
        secondary:
          "bg-surface-hover text-secondary-foreground hover:bg-secondary-200 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground dark:bg-secondary-700 dark:text-foreground dark:hover:bg-secondary-600",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/30 dark:text-red-400 dark:hover:bg-destructive/40 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        oauth:
          "bg-oauth-primary text-oauth-primary-foreground hover:bg-oauth-primary-hover",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        auth: "h-11 gap-2 px-4 rounded-full",
        icon: "size-9",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function spinnerSizeForButton(
  size: VariantProps<typeof buttonVariants>["size"],
): "xs" | "sm" | "md" | "lg" {
  switch (size) {
    case "lg":
    case "icon":
    case "icon-lg":
      return "sm"
    default:
      return "xs"
  }
}

function isIconButtonSize(
  size: VariantProps<typeof buttonVariants>["size"],
): boolean {
  return size === "icon" || size === "icon-xs" || size === "icon-sm" || size === "icon-lg"
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  if (asChild) {
    return (
      <Comp
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }))}
        {...props}
      >
        {children}
      </Comp>
    )
  }

  const replaceChildrenWithSpinner = loading && isIconButtonSize(size)

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={loading || props.disabled}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {loading ? <Spinner size={spinnerSizeForButton(size)} aria-hidden /> : null}
      {replaceChildrenWithSpinner ? null : children}
    </Comp>
  )
}

export { Button, buttonVariants }
