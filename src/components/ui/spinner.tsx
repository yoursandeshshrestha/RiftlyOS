import { cn } from '@/lib/utils'

interface SpinnerProps {
  className?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  'aria-label'?: string
}

const SPINNER_BARS = 8

const sizeConfig = {
  xs: { box: 14, barWidth: 1.5, barHeight: 3.5 },
  sm: { box: 20, barWidth: 2, barHeight: 5 },
  md: { box: 28, barWidth: 2.5, barHeight: 7 },
  lg: { box: 36, barWidth: 3, barHeight: 9 },
} as const

function Spinner({ className, size = 'sm', 'aria-label': ariaLabel = 'Loading' }: SpinnerProps) {
  const { box, barWidth, barHeight } = sizeConfig[size]
  const radius = box / 2 - barHeight / 2

  return (
    <div
      role="status"
      aria-label={ariaLabel}
      className={cn('relative inline-block shrink-0 text-current', className)}
      style={{ width: box, height: box }}
    >
      {Array.from({ length: SPINNER_BARS }, (_, index) => (
        <span
          key={index}
          className="spinner-ios-bar absolute left-1/2 top-1/2 rounded-full bg-current"
          style={{
            width: barWidth,
            height: barHeight,
            marginLeft: -barWidth / 2,
            marginTop: -barHeight / 2,
            transform: `rotate(${index * 45}deg) translateY(-${radius}px)`,
            animationDelay: `${-(SPINNER_BARS - 1 - index) * 0.1}s`,
          }}
        />
      ))}
    </div>
  )
}

export { Spinner }
