interface InfoLineProps {
  label: string
  children: React.ReactNode
}

export function InfoLine({ label, children }: InfoLineProps) {
  return (
    <p className="text-sm leading-snug">
      <span className="text-muted-foreground">{label}: </span>
      <span className="inline-flex min-w-0 flex-wrap items-center gap-1 break-words text-muted-foreground">
        {children}
      </span>
    </p>
  )
}
