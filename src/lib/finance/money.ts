/**
 * Money utilities for handling currency conversions and formatting.
 * All database amounts are stored as INTEGER minor units (pence/cents) to avoid float drift.
 */

const MINOR_UNIT_FACTOR: Record<string, number> = {
  gbp: 100,
  usd: 100,
  eur: 100,
}

const SYMBOL: Record<string, string> = {
  gbp: '£',
  usd: '$',
  eur: '€',
}

function factor(currency: string): number {
  return MINOR_UNIT_FACTOR[currency.toLowerCase()] ?? 100
}

/**
 * Convert major units (e.g. 10.50 GBP) to minor units (1050 pence)
 * Rounds half-up to avoid float drift
 */
export function toMinorUnits(major: number, currency: string): number {
  return Math.round(major * factor(currency))
}

/**
 * Convert minor units (e.g. 1050 pence) to major units (10.50 GBP)
 */
export function fromMinorUnits(minor: number, currency: string): number {
  return minor / factor(currency)
}

/**
 * Format minor units as currency string with symbol
 * e.g. formatMoney(120000, 'gbp') => '£1,200.00'
 */
export function formatMoney(minor: number, currency: string): string {
  const c = currency.toLowerCase()
  const symbol = SYMBOL[c] ?? ''
  const major = fromMinorUnits(minor, c)
  const formatted = major.toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${symbol}${formatted}`
}

/**
 * Sum line items (qty × unit + tax) in minor units
 * Returns { subtotal, taxTotal, total }
 */
export function sumLineItems(
  items: Array<{ quantity: number; unitAmount: number; taxAmount: number }>,
): { subtotal: number; taxTotal: number; total: number } {
  const subtotal = items.reduce((acc, i) => acc + i.quantity * i.unitAmount, 0)
  const taxTotal = items.reduce((acc, i) => acc + i.taxAmount, 0)
  return { subtotal, taxTotal, total: subtotal + taxTotal }
}
