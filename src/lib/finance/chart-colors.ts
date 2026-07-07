type ChartIndex = 1 | 2 | 3 | 4 | 5

const FALLBACKS: Record<ChartIndex, string> = {
  1: 'oklch(0.52 0.17 152)',
  2: 'oklch(0.48 0.14 255)',
  3: 'oklch(0.45 0.12 285)',
  4: 'oklch(0.62 0.16 75)',
  5: 'oklch(0.55 0.20 25)',
}

const DARK_FALLBACKS: Record<ChartIndex, string> = {
  1: 'oklch(0.80 0.18 151.71)',
  2: 'oklch(0.71 0.14 254.62)',
  3: 'oklch(0.71 0.16 293.54)',
  4: 'oklch(0.84 0.16 84.43)',
  5: 'oklch(0.78 0.13 181.91)',
}

function isDarkMode(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.classList.contains('dark')
}

function readCssVar(name: string): string {
  if (typeof document === 'undefined') return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function getChartColor(index: ChartIndex): string {
  const value = readCssVar(`--chart-${index}`)
  if (value) return value
  return isDarkMode() ? DARK_FALLBACKS[index] : FALLBACKS[index]
}

export function getChartTrackColor(): string {
  const value = readCssVar('--chart-track')
  if (value) return value
  return isDarkMode() ? 'oklch(0.28 0 0)' : 'oklch(0.88 0 0)'
}

export function getGaugeColor(percent: number): string {
  if (percent >= 100) return getChartColor(1)
  if (percent >= 75) return getChartColor(2)
  if (percent >= 50) return getChartColor(4)
  return getChartColor(5)
}
