import * as React from "react"

import { cn } from "@/lib/utils"

type CardVariant = "default" | "table"

function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: CardVariant }) {
  return (
    <div
      data-slot="card"
      data-variant={variant}
      className={cn(
        "group/card flex flex-col overflow-hidden rounded-lg bg-sidebar text-[13px] text-foreground",
        variant === "default" && "gap-3 p-4",
        variant === "table" && "gap-0 p-0",
        className
      )}
      {...props}
    />
  )
}

function CardEyebrow({
  className,
  title,
  description,
  action,
  variant = "section",
}: {
  className?: string
  title: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  variant?: "section" | "table"
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3",
        variant === "table" && "border-b border-border-table px-4 py-3",
        className
      )}
    >
      <div className="min-w-0">
        <div className="text-[13px] font-medium text-foreground">{title}</div>
        {description ? (
          <div className="mt-0.5 text-[12px] text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </div>
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:border-b [.border-b]:border-border-table [.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-[13px] font-medium text-foreground", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-[12px] text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("min-w-0", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center [.border-t]:border-t [.border-t]:border-border-table [.border-t]:pt-3",
        className
      )}
      {...props}
    />
  )
}

export {
  Card,
  CardEyebrow,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
