interface PanelFormRowProps {
  label: string
  children: React.ReactNode
  className?: string
}

/** Label/value row matching Thrumble detail panel grid. */
export function PanelFormRow({ label, children, className }: PanelFormRowProps) {
  return (
    <div
      className={`grid min-w-0 grid-cols-[72px_minmax(0,1fr)] items-start gap-x-3 text-sm leading-snug ${className ?? ''}`}
    >
      <span className="pt-0.5 text-muted-foreground">{label}</span>
      <div className="min-w-0 text-muted-foreground">{children}</div>
    </div>
  )
}
