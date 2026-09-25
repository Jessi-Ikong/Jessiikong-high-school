const dateFormatter = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
})

// '2026-09-07' -> '7 Sept 2026'. Dates from the database have no time zone,
// so format them as UTC to avoid showing the day before.
export function formatDate(isoDate) {
  if (!isoDate) return ''
  return dateFormatter.format(new Date(`${isoDate}T00:00:00Z`))
}

// '08:00:00' -> '08:00' (times from the database include seconds).
export function formatTime(time) {
  return time ? time.slice(0, 5) : ''
}

const nairaFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' })

// 50000 -> '₦50,000.00'
export function formatNaira(amount) {
  return nairaFormatter.format(Number(amount ?? 0))
}

const nairaCompact = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', notation: 'compact', maximumFractionDigits: 1 })

// 6150000 -> '₦6.2M' (for small spaces like stat tiles; show the exact amount nearby)
export function formatNairaCompact(amount) {
  return nairaCompact.format(Number(amount ?? 0))
}
